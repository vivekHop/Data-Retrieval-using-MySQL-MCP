from fastapi import APIRouter, HTTPException, status
from typing import Dict, Any, List
from app.db import get_client_manager
from app.models import JdbcConnectRequest

router = APIRouter(prefix="/metadata", tags=["metadata"])


def _mgr():
    """Shorthand: returns the DatabaseManager for the current HTTP request's client."""
    return get_client_manager()


@router.get("/databases", response_model=List[str])
async def get_cached_databases():
    """Retrieves available databases from this client's metadata cache."""
    return list(_mgr().metadata_cache.keys())


@router.get("/schema/{database}", response_model=Dict[str, Any])
async def get_cached_schema(database: str):
    """Retrieves table / column metadata from this client's metadata cache."""
    cache = _mgr().metadata_cache
    if database not in cache:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database '{database}' not found in cache.",
        )
    db_meta = cache[database]
    result = {}
    for table_name, table_meta in db_meta.tables.items():
        result[table_name] = {
            "columns": [
                {
                    "name": col.name,
                    "type": col.data_type,
                    "is_primary": col.is_primary,
                    "is_foreign": col.is_foreign,
                    "referenced_table": col.referenced_table,
                    "referenced_column": col.referenced_column,
                }
                for col in table_meta.columns
            ],
            "primary_keys": table_meta.primary_keys,
            "foreign_keys": table_meta.foreign_keys,
        }
    return result


@router.post("/refresh")
async def refresh_metadata():
    """Force re-crawl of the currently connected JDBC source for this client."""
    mgr = _mgr()
    if not mgr.is_connected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active database connection to refresh.",
        )
    mgr.force_refresh_cache()
    return {
        "status": "success",
        "message": "Metadata cache refreshed.",
        "databases": list(mgr.metadata_cache.keys()),
    }


@router.post("/hard-refresh")
async def hard_refresh_metadata():
    """
    Purge the SHARED schema cache for the active JDBC source and force a full re-crawl.
    This is a heavy operation — all clients on the same JDBC server will get fresh schema
    on their next request. Use when DDL changes have been made.
    """
    from app.db import _shared_metadata_cache, _shared_metadata_cache_ts
    mgr = _mgr()
    if not mgr.is_connected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active database connection.",
        )
    base_url = mgr.get_active_base_url()
    # Evict the shared cache so the crawl runs unconditionally
    _shared_metadata_cache.pop(base_url, None)
    _shared_metadata_cache_ts.pop(base_url, None)
    # Re-crawl immediately
    mgr.force_refresh_cache()
    return {
        "status": "success",
        "message": f"Hard refresh complete for '{base_url}'. All clients will see fresh schema.",
        "databases": list(mgr.metadata_cache.keys()),
    }


@router.post("/connect")
async def connect_database(request: JdbcConnectRequest):
    """
    Connect THIS client session to the given JDBC URL.

    • Clears any previous connection for this client.
    • Re-uses the shared schema cache if another client already loaded the
      same JDBC server (fast path).
    • Does NOT ask the user for a database name — all DBs on the server are
      auto-discovered.
    """
    mgr = _mgr()
    try:
        mgr.connect_via_jdbc(request.jdbc_url, request.username, request.password)
        return {
            "status": "success",
            "message": "Successfully connected to the database.",
            "databases": list(mgr.metadata_cache.keys()),
            "connection_info": {
                "connected": True,
                "base_url": mgr.get_active_base_url(),
                "engine_type": mgr.engine_type,
                "database": mgr.conn_params.get("database", "") if mgr.conn_params else "",
            },
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Database connection failed: {str(e)}",
        )


@router.get("/connection-info")
async def get_connection_info():
    """Returns the active JDBC connection state for THIS client session."""
    mgr = _mgr()
    return {
        "connected": mgr.engine_type is not None,
        "base_url": mgr.get_active_base_url(),
        "engine_type": mgr.engine_type,
        "database": mgr.conn_params.get("database", "") if mgr.conn_params else "",
    }


@router.get("/uat-info")
async def get_uat_info():
    """Returns the pre-configured UAT JDBC credentials from environment config."""
    from app.config import settings
    return {
        "jdbc_url": settings.DEFAULT_JDBC_URL,
        "username": settings.DEFAULT_DB_USER,
        "password": settings.DEFAULT_DB_PASSWORD,
    }
