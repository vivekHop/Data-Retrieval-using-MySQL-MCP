import time
import logging
import psycopg2
import mysql.connector
from contextvars import ContextVar
from typing import List, Dict, Any, Tuple, Optional
from app.config import settings
from app.models import DatabaseMetadata, TableMetadata, ColumnMetadata

logger = logging.getLogger(__name__)

# ── Context variable: set per-HTTP-request by middleware in main.py ──────────
client_id_var: ContextVar[str] = ContextVar("client_id", default="default")

# ── Schema cache TTL (seconds). After this the next connect re-crawls. ───────
SCHEMA_CACHE_TTL_SECONDS = 1800  # 30 minutes


# ─────────────────────────────────────────────────────────────────────────────
# URL helpers
# ─────────────────────────────────────────────────────────────────────────────

def clean_jdbc_url(url: str) -> str:
    """Fix common JDBC URL typos (e.g. port appended after query params)."""
    url = url.strip()
    if "?" in url and ":3306" in url and url.find(":3306") > url.find("?"):
        url = url.replace(":3306/", "")
        url = url.replace(":3306", "")
        for prefix in ["jdbc:mysql://", "mysql://"]:
            if url.startswith(prefix):
                rem = url[len(prefix):]
                if "/" in rem:
                    host_part, db_part = rem.split("/", 1)
                    if ":" not in host_part:
                        url = f"{prefix}{host_part}:3306/{db_part}"
                break
    return url


def parse_mysql_jdbc_url(url: str) -> Dict[str, Any]:
    url = clean_jdbc_url(url)
    if url.startswith("jdbc:"):
        url = url[5:]

    if not url.startswith("mysql://"):
        raise ValueError("Invalid JDBC URL. Must start with 'jdbc:mysql://'")

    body = url[8:]
    if "?" in body:
        db_part, query_part = body.split("?", 1)
    else:
        db_part, query_part = body, ""

    if "/" in db_part:
        hp_part, database = db_part.split("/", 1)
        database = database.split("/")[0]
    else:
        hp_part = db_part
        database = ""

    user = "root"
    password = ""

    if "@" in hp_part:
        user_pass_part, host_port_part = hp_part.split("@", 1)
        if ":" in user_pass_part:
            user, password = user_pass_part.split(":", 1)
        else:
            user = user_pass_part
        hp_part = host_port_part

    if ":" in hp_part:
        host, port_str = hp_part.split(":", 1)
        try:
            port = int(port_str)
        except ValueError:
            port = 3306
    else:
        host = hp_part
        port = 3306

    if query_part:
        from urllib.parse import parse_qsl
        q_params = dict(parse_qsl(query_part))
        if "user" in q_params:
            user = q_params["user"]
        if "password" in q_params:
            password = q_params["password"]

    return {
        "host": host,
        "port": port,
        "database": database,
        "user": user,
        "password": password,
    }


def _compute_base_url(engine_type: str, conn_params: dict) -> str:
    """Return a stable identifier for the JDBC server (no credentials, no DB)."""
    if engine_type == "postgres":
        url = conn_params.get("url", "")
        for prefix in ["postgresql://", "postgres://"]:
            if url.startswith(prefix):
                url = url[len(prefix):]
                break
        if "@" in url:
            url = url.split("@", 1)[1]
        if "?" in url:
            url = url.split("?", 1)[0]
        # strip the database path so we key only by host:port
        parts = url.rstrip("/").split("/")
        return parts[0]          # host:port
    else:
        host = conn_params.get("host", "unknown")
        port = conn_params.get("port", "")
        base = f"{host}"
        if port:
            base += f":{port}"
        return base


# ─────────────────────────────────────────────────────────────────────────────
# Shared metadata cache  (keyed by base_url — not by client)
# ─────────────────────────────────────────────────────────────────────────────
# This means: if two clients connect to the *same* JDBC server, they share the
# already-populated schema cache ⟹ instant "reconnect" for identical sources.
# Each client still has its own DatabaseManager tracking WHICH source it's on.

_shared_metadata_cache: Dict[str, Dict[str, DatabaseMetadata]] = {}
# Timestamps of when each base_url's cache was last populated
_shared_metadata_cache_ts: Dict[str, float] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Per-client session registry
# ─────────────────────────────────────────────────────────────────────────────

class DatabaseManager:
    """Manages a single client's active JDBC connection and exposes metadata."""

    def __init__(self):
        self.engine_type: Optional[str] = None
        self.conn_params: dict = {}
        self._base_url: str = "none"

    # ── public API ────────────────────────────────────────────────────────────

    @property
    def is_connected(self) -> bool:
        return self.engine_type is not None

    @property
    def is_mysql(self) -> bool:
        return self.engine_type == "mysql"

    @property
    def metadata_cache(self) -> Dict[str, DatabaseMetadata]:
        return _shared_metadata_cache.get(self._base_url, {})

    def get_active_base_url(self) -> str:
        return self._base_url

    def initialize_connection(self):
        """Reset this client's connection state (does NOT wipe shared cache)."""
        self.engine_type = None
        self.conn_params = {}
        self._base_url = "none"

    def connect_via_jdbc(
        self,
        jdbc_url: str,
        username: Optional[str] = None,
        password: Optional[str] = None,
    ) -> None:
        """
        Connect this client session to the given JDBC source.

        • If another client is already connected to the same base URL the shared
          metadata cache is reused → zero re-fetch time.
        • If it's a new source the full schema crawl runs once and is stored in
          the shared cache for future callers.
        • Switching to a different source clears THIS client's pointer; the old
          shared cache entry is kept (other clients using it are unaffected).
        """
        url = clean_jdbc_url(jdbc_url.strip())

        is_postgres_url = (
            url.startswith("postgresql://")
            or url.startswith("postgres://")
            or url.startswith("jdbc:postgresql://")
        )

        if is_postgres_url:
            pg_url = url
            if pg_url.startswith("jdbc:postgresql://"):
                pg_url = pg_url[5:]
            elif pg_url.startswith("postgres://"):
                pg_url = "postgresql://" + pg_url[11:]

            # Inject explicit credentials if provided
            if username and password:
                # rebuild URL with supplied creds
                # postgresql://old_user:old_pass@host/db  →  postgresql://new_user:new_pass@host/db
                bare = pg_url[len("postgresql://"):]
                if "@" in bare:
                    bare = bare.split("@", 1)[1]
                pg_url = f"postgresql://{username}:{password}@{bare}"

            # Test connection
            try:
                conn = psycopg2.connect(pg_url, connect_timeout=5)
                conn.close()
            except Exception as e:
                logger.error(f"Failed to connect to PostgreSQL: {e}")
                raise

            self.engine_type = "postgres"
            self.conn_params = {"url": pg_url}

        else:
            if not url.startswith("mysql://") and not url.startswith("jdbc:mysql://"):
                url = "jdbc:mysql://" + url

            params = parse_mysql_jdbc_url(url)
            if username:
                params["user"] = username
            if password:
                params["password"] = password

            # Test connection
            try:
                conn = mysql.connector.connect(
                    host=params["host"],
                    port=params["port"],
                    user=params["user"],
                    password=params["password"],
                    database=params.get("database") or None,
                    connect_timeout=5,
                )
                conn.close()
            except Exception as e:
                logger.error(f"Failed to connect to MySQL: {e}")
                raise

            self.engine_type = "mysql"
            self.conn_params = params

        new_base_url = _compute_base_url(self.engine_type, self.conn_params)
        self._base_url = new_base_url

        # Check whether the shared cache for this source is still fresh
        cached_at = _shared_metadata_cache_ts.get(new_base_url, 0.0)
        cache_age = time.time() - cached_at
        if new_base_url not in _shared_metadata_cache or cache_age > SCHEMA_CACHE_TTL_SECONDS:
            if new_base_url in _shared_metadata_cache:
                logger.info(
                    f"Cache for '{new_base_url}' expired ({cache_age/60:.1f} min old) — refreshing…"
                )
            else:
                logger.info(f"New JDBC source '{new_base_url}' — loading schema cache…")
            self._refresh_shared_cache()
        else:
            logger.info(
                f"JDBC source '{new_base_url}' cache is fresh "
                f"({cache_age/60:.1f} min old, TTL={SCHEMA_CACHE_TTL_SECONDS/60:.0f} min) — skipping re-fetch."
            )

        logger.info(
            f"Client '{client_id_var.get()}' connected to {self.engine_type} @ {new_base_url}"
        )

    def force_refresh_cache(self):
        """Re-crawl the active source and update the shared cache."""
        if not self.is_connected:
            return
        self._refresh_shared_cache()

    # ── connection factory ────────────────────────────────────────────────────

    def get_connection(self):
        if not self.engine_type:
            raise ValueError(
                "No active database connection. Please connect via the Connection panel."
            )
        if self.engine_type == "postgres":
            return psycopg2.connect(self.conn_params["url"])
        else:
            return mysql.connector.connect(
                host=self.conn_params["host"],
                port=self.conn_params["port"],
                user=self.conn_params["user"],
                password=self.conn_params["password"],
                database=self.conn_params.get("database") or None,
            )

    # ── query execution ───────────────────────────────────────────────────────

    def execute_query(
        self, sql_query: str
    ) -> Tuple[List[str], List[List[Any]], float]:
        import datetime
        import decimal

        def sanitize_value(v: Any) -> Any:
            if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
                return v.isoformat()
            elif isinstance(v, decimal.Decimal):
                try:
                    return float(v)
                except:
                    return str(v)
            elif isinstance(v, (bytes, bytearray)):
                try:
                    return v.decode("utf-8", errors="replace")
                except:
                    return str(v)
            return v

        conn = self.get_connection()
        cursor = conn.cursor()
        start = time.time()
        try:
            if self.engine_type == "postgres":
                cursor.execute(
                    f"SET statement_timeout = {settings.QUERY_TIMEOUT_SECONDS * 1000}"
                )
            elif self.engine_type == "mysql":
                cursor.execute(
                    f"SET SESSION max_execution_time = {settings.QUERY_TIMEOUT_SECONDS * 1000}"
                )
            cursor.execute(sql_query)
            if cursor.description:
                rows = cursor.fetchall()
                columns = [d[0] for d in cursor.description]
                sanitized_rows = []
                for r in rows:
                    sanitized_rows.append([sanitize_value(cell) for cell in r])
                return columns, sanitized_rows, (time.time() - start) * 1000
            return [], [], (time.time() - start) * 1000
        except Exception as e:
            logger.error(f"Query execution error: {e}")
            raise
        finally:
            cursor.close()
            conn.close()

    # ── private schema crawl ──────────────────────────────────────────────────

    def _refresh_shared_cache(self):
        logger.info(f"Crawling schema for '{self._base_url}' …")
        new_cache: Dict[str, DatabaseMetadata] = {}
        try:
            conn = self.get_connection()
            cursor = conn.cursor()

            if self.engine_type == "postgres":
                cursor.execute("""
                    SELECT schema_name
                    FROM information_schema.schemata
                    WHERE schema_name NOT IN ('pg_catalog','information_schema')
                      AND schema_name NOT LIKE 'pg_toast%'
                      AND schema_name NOT LIKE 'pg_temp%'
                """)
                schemas = [r[0] for r in cursor.fetchall()]

                for schema in schemas:
                    new_cache[schema] = DatabaseMetadata(name=schema, tables={})

                    cursor.execute("""
                        SELECT table_name FROM information_schema.tables
                        WHERE table_schema = %s AND table_type = 'BASE TABLE'
                    """, (schema,))
                    tables = [r[0] for r in cursor.fetchall()]

                    cursor.execute("""
                        SELECT kcu.table_name, kcu.column_name
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage kcu
                          ON tc.constraint_name = kcu.constraint_name
                         AND tc.table_schema = kcu.table_schema
                        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = %s
                    """, (schema,))
                    pks: Dict[str, List[str]] = {}
                    for t, c in cursor.fetchall():
                        pks.setdefault(t, []).append(c)

                    cursor.execute("""
                        SELECT kcu.table_name, kcu.column_name,
                               ccu.table_name, ccu.column_name
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage kcu
                          ON tc.constraint_name = kcu.constraint_name
                         AND tc.table_schema = kcu.table_schema
                        JOIN information_schema.constraint_column_usage ccu
                          ON ccu.constraint_name = tc.constraint_name
                        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = %s
                    """, (schema,))
                    fks: Dict[str, list] = {}
                    for t, c, ft, fc in cursor.fetchall():
                        fks.setdefault(t, []).append(
                            {"column": c, "ref_table": ft, "ref_column": fc}
                        )

                    for table in tables:
                        cursor.execute("""
                            SELECT column_name, data_type
                            FROM information_schema.columns
                            WHERE table_schema = %s AND table_name = %s
                            ORDER BY ordinal_position
                        """, (schema, table))
                        cols = []
                        for col_name, dtype in cursor.fetchall():
                            is_pri = col_name in pks.get(table, [])
                            fk_info = next(
                                (f for f in fks.get(table, []) if f["column"] == col_name),
                                None,
                            )
                            cols.append(ColumnMetadata(
                                name=col_name, data_type=dtype,
                                is_primary=is_pri,
                                is_foreign=fk_info is not None,
                                referenced_table=fk_info["ref_table"] if fk_info else None,
                                referenced_column=fk_info["ref_column"] if fk_info else None,
                            ))
                        new_cache[schema].tables[table] = TableMetadata(
                            name=table, columns=cols,
                            primary_keys=pks.get(table, []),
                            foreign_keys=fks.get(table, []),
                        )

            elif self.engine_type == "mysql":
                cursor.execute("SHOW DATABASES")
                dbs = [r[0] for r in cursor.fetchall()]
                exclude = {"information_schema", "mysql", "performance_schema", "sys"}
                target_dbs = [d for d in dbs if d.lower() not in exclude]

                for db in target_dbs:
                    new_cache[db] = DatabaseMetadata(name=db, tables={})

                    cursor.execute(f"""
                        SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                        WHERE TABLE_SCHEMA = '{db}'
                    """)
                    tables = [r[0] for r in cursor.fetchall()]

                    cursor.execute(f"""
                        SELECT TABLE_NAME, COLUMN_NAME
                        FROM INFORMATION_SCHEMA.COLUMNS
                        WHERE TABLE_SCHEMA = '{db}' AND COLUMN_KEY = 'PRI'
                    """)
                    pks: Dict[str, List[str]] = {}
                    for t, c in cursor.fetchall():
                        pks.setdefault(t, []).append(c)

                    cursor.execute(f"""
                        SELECT TABLE_NAME, COLUMN_NAME,
                               REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                        WHERE TABLE_SCHEMA = '{db}'
                          AND REFERENCED_TABLE_NAME IS NOT NULL
                    """)
                    fks: Dict[str, list] = {}
                    for t, c, ft, fc in cursor.fetchall():
                        fks.setdefault(t, []).append(
                            {"column": c, "ref_table": ft, "ref_column": fc}
                        )

                    for table in tables:
                        cursor.execute(f"""
                            SELECT COLUMN_NAME, DATA_TYPE
                            FROM INFORMATION_SCHEMA.COLUMNS
                            WHERE TABLE_SCHEMA = '{db}' AND TABLE_NAME = '{table}'
                            ORDER BY ORDINAL_POSITION
                        """)
                        cols = []
                        for col_name, dtype in cursor.fetchall():
                            is_pri = col_name in pks.get(table, [])
                            fk_info = next(
                                (f for f in fks.get(table, []) if f["column"] == col_name),
                                None,
                            )
                            cols.append(ColumnMetadata(
                                name=col_name, data_type=dtype,
                                is_primary=is_pri,
                                is_foreign=fk_info is not None,
                                referenced_table=fk_info["ref_table"] if fk_info else None,
                                referenced_column=fk_info["ref_column"] if fk_info else None,
                            ))
                        new_cache[db].tables[table] = TableMetadata(
                            name=table, columns=cols,
                            primary_keys=pks.get(table, []),
                            foreign_keys=fks.get(table, []),
                        )

            cursor.close()
            conn.close()
            _shared_metadata_cache[self._base_url] = new_cache
            _shared_metadata_cache_ts[self._base_url] = time.time()
            logger.info(
                f"Schema cache for '{self._base_url}' loaded: {list(new_cache.keys())}"
            )
        except Exception as e:
            logger.error(f"Schema crawl error for '{self._base_url}': {e}")
            _shared_metadata_cache[self._base_url] = {}
            _shared_metadata_cache_ts[self._base_url] = time.time()  # prevent retry storm


# ─────────────────────────────────────────────────────────────────────────────
# Per-client session registry
# ─────────────────────────────────────────────────────────────────────────────

_client_sessions: Dict[str, DatabaseManager] = {}


def get_client_manager() -> DatabaseManager:
    """
    Return the DatabaseManager for the current HTTP client.

    The client is identified by the `X-Client-Id` header value, which is placed
    into `client_id_var` by the middleware in main.py before every request.
    """
    client_id = client_id_var.get()
    if client_id not in _client_sessions:
        _client_sessions[client_id] = DatabaseManager()
    return _client_sessions[client_id]


# ── Backwards-compatible global alias used by legacy imports ─────────────────
# (gemini.py / mcp_server.py still import `db_manager` directly; they run
#  inside a request context so client_id_var is already set.)

class _ProxyManager:
    """
    Transparent proxy that always delegates to the current client's manager.
    Legacy code that does `from app.db import db_manager` continues to work
    without modification — each request sees its own isolated session.
    """

    def __getattr__(self, name):
        return getattr(get_client_manager(), name)

    def __setattr__(self, name, value):
        if name.startswith("_"):
            object.__setattr__(self, name, value)
        else:
            setattr(get_client_manager(), name, value)


db_manager = _ProxyManager()
