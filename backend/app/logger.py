import datetime
import logging
import psycopg2
import json
from typing import List, Dict, Any, Optional
from app.models import AuditLogEntry
from app.config import settings

logger = logging.getLogger(__name__)

def init_audit_db():
    """Initializes the PostgreSQL database for audit logs and user chats on Neon."""
    if not settings.DATABASE_URL:
        logger.warning("No DATABASE_URL configured for logging.")
        return
    try:
        conn = psycopg2.connect(settings.DATABASE_URL)
        cursor = conn.cursor()
        
        # 1. Audit logs
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255) NOT NULL,
                timestamp VARCHAR(255) NOT NULL,
                question TEXT NOT NULL,
                generated_sql TEXT,
                database_used VARCHAR(255),
                execution_time_ms REAL,
                status VARCHAR(50) NOT NULL,
                error_message TEXT
            )
        """)
        
        # 2. User Conversations
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id VARCHAR(255) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                timestamp VARCHAR(255) NOT NULL,
                username VARCHAR(255) NOT NULL,
                jdbc_url TEXT
            )
        """)
        # Migration for existing databases
        cursor.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS jdbc_url TEXT")
        
        # 3. Conversation Messages (including execution timeline steps!)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conversation_messages (
                id VARCHAR(255) PRIMARY KEY,
                conversation_id VARCHAR(255) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role VARCHAR(50) NOT NULL,
                text TEXT NOT NULL,
                sql TEXT,
                columns TEXT, -- JSON array of column names
                rows TEXT, -- JSON array of row values
                execution_time_ms REAL,
                row_count INTEGER,
                database_used VARCHAR(255),
                error_message TEXT,
                timestamp VARCHAR(255) NOT NULL,
                suggested_questions TEXT, -- JSON array of strings
                steps TEXT -- JSON array of timeline steps
            )
        """)
        
        conn.commit()
        cursor.close()
        conn.close()
        logger.info("Neon PostgreSQL audit logs and chat tables initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize PostgreSQL tables: {e}")

def log_query(
    user_id: str,
    question: str,
    generated_sql: Optional[str] = None,
    database_used: Optional[str] = None,
    execution_time_ms: float = 0.0,
    status: str = "SUCCESS",
    error_message: Optional[str] = None
):
    """Inserts a query execution record into the PostgreSQL audit log on Neon."""
    if not settings.DATABASE_URL:
        return
    try:
        conn = psycopg2.connect(settings.DATABASE_URL)
        cursor = conn.cursor()
        timestamp = datetime.datetime.utcnow().isoformat()
        
        cursor.execute("""
            INSERT INTO audit_logs (
                user_id, timestamp, question, generated_sql, database_used, execution_time_ms, status, error_message
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (user_id, timestamp, question, generated_sql, database_used, execution_time_ms, status, error_message))
        
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to write PostgreSQL query audit log: {e}")

def get_audit_logs(limit: int = 100) -> List[AuditLogEntry]:
    """Retrieves the most recent PostgreSQL audit log entries on Neon."""
    logs = []
    if not settings.DATABASE_URL:
        return logs
    try:
        conn = psycopg2.connect(settings.DATABASE_URL)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, user_id, timestamp, question, generated_sql, database_used, execution_time_ms, status, error_message
            FROM audit_logs
            ORDER BY id DESC
            LIMIT %s
        """, (limit,))
        rows = cursor.fetchall()
        for r in rows:
            logs.append(AuditLogEntry(
                id=r[0],
                user_id=r[1],
                timestamp=r[2],
                question=r[3],
                generated_sql=r[4],
                database_used=r[5],
                execution_time_ms=r[6],
                status=r[7],
                error_message=r[8]
            ))
        cursor.close()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to retrieve PostgreSQL query audit logs: {e}")
    return logs

# Chat Database Access Methods

def get_active_base_url() -> str:
    try:
        from app.db import get_client_manager
        return get_client_manager().get_active_base_url()
    except Exception:
        return "none"

def db_save_conversation(conversation_id: str, title: str, username: str, jdbc_url: Optional[str] = None):
    """Saves or updates a conversation record in the Neon database tagged with active database."""
    if not settings.DATABASE_URL:
        return
    try:
        if not jdbc_url:
            jdbc_url = get_active_base_url()
        conn = psycopg2.connect(settings.DATABASE_URL)
        cursor = conn.cursor()
        timestamp = datetime.datetime.utcnow().isoformat()
        
        cursor.execute("""
            INSERT INTO conversations (id, title, timestamp, username, jdbc_url)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE 
            SET title = EXCLUDED.title, timestamp = EXCLUDED.timestamp, jdbc_url = EXCLUDED.jdbc_url
        """, (conversation_id, title, timestamp, username, jdbc_url))
        
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to save conversation in DB: {e}")

def db_delete_conversation(conversation_id: str):
    """Deletes a conversation from the Neon database."""
    if not settings.DATABASE_URL:
        return
    try:
        conn = psycopg2.connect(settings.DATABASE_URL)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM conversations WHERE id = %s", (conversation_id,))
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to delete conversation: {e}")

def db_get_conversations(username: str, jdbc_url: Optional[str] = None) -> List[Dict[str, Any]]:
    """Loads all conversations for a specific user from the Neon database, filtered by database URL."""
    results = []
    if not settings.DATABASE_URL:
        return results
    try:
        if not jdbc_url:
            jdbc_url = get_active_base_url()
        conn = psycopg2.connect(settings.DATABASE_URL)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, title, timestamp, jdbc_url 
            FROM conversations 
            WHERE username = %s AND (jdbc_url = %s OR jdbc_url IS NULL)
            ORDER BY timestamp DESC
        """, (username, jdbc_url))
        for r in cursor.fetchall():
            results.append({
                "id": r[0],
                "title": r[1],
                "timestamp": r[2],
                "jdbc_url": r[3]
            })
        cursor.close()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to retrieve conversations: {e}")
    return results

def db_get_conversation_jdbc_url(conversation_id: str) -> Optional[str]:
    """Retrieves the tagged jdbc_url for a conversation."""
    if not settings.DATABASE_URL:
        return None
    try:
        conn = psycopg2.connect(settings.DATABASE_URL)
        cursor = conn.cursor()
        cursor.execute("SELECT jdbc_url FROM conversations WHERE id = %s", (conversation_id,))
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        if row:
            return row[0]
    except Exception as e:
        logger.error(f"Failed to get conversation JDBC URL: {e}")
    return None

def db_save_message(
    msg_id: str,
    conversation_id: str,
    role: str,
    text: str,
    sql: Optional[str] = None,
    columns: Optional[List[str]] = None,
    rows: Optional[List[List[Any]]] = None,
    execution_time_ms: float = 0.0,
    row_count: int = 0,
    database_used: Optional[str] = None,
    error_message: Optional[str] = None,
    suggested_questions: Optional[List[str]] = None,
    steps: Optional[List[Dict[str, Any]]] = None
):
    """Inserts a conversation message into the Neon database."""
    if not settings.DATABASE_URL:
        return
    try:
        conn = psycopg2.connect(settings.DATABASE_URL)
        cursor = conn.cursor()
        timestamp = datetime.datetime.utcnow().isoformat()
        
        cols_str = json.dumps(columns) if columns is not None else None
        rows_str = json.dumps(rows) if rows is not None else None
        sug_str = json.dumps(suggested_questions) if suggested_questions is not None else None
        steps_str = json.dumps(steps) if steps is not None else None
        
        cursor.execute("""
            INSERT INTO conversation_messages (
                id, conversation_id, role, text, sql, columns, rows, 
                execution_time_ms, row_count, database_used, error_message, 
                timestamp, suggested_questions, steps
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                text = EXCLUDED.text,
                sql = EXCLUDED.sql,
                columns = EXCLUDED.columns,
                rows = EXCLUDED.rows,
                execution_time_ms = EXCLUDED.execution_time_ms,
                row_count = EXCLUDED.row_count,
                database_used = EXCLUDED.database_used,
                error_message = EXCLUDED.error_message,
                suggested_questions = EXCLUDED.suggested_questions,
                steps = EXCLUDED.steps
        """, (
            msg_id, conversation_id, role, text, sql, cols_str, rows_str,
            execution_time_ms, row_count, database_used, error_message,
            timestamp, sug_str, steps_str
        ))
        
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to save message: {e}")

def db_get_messages(conversation_id: str) -> List[Dict[str, Any]]:
    """Loads all messages for a specific conversation from the Neon database."""
    results = []
    if not settings.DATABASE_URL:
        return results
    try:
        conn = psycopg2.connect(settings.DATABASE_URL)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, role, text, sql, columns, rows, execution_time_ms, 
                   row_count, database_used, error_message, timestamp, suggested_questions, steps
            FROM conversation_messages
            WHERE conversation_id = %s
            ORDER BY timestamp ASC
        """, (conversation_id,))
        for r in cursor.fetchall():
            cols = json.loads(r[4]) if r[4] else None
            rows = json.loads(r[5]) if r[5] else None
            sugs = json.loads(r[11]) if r[11] else []
            steps = json.loads(r[12]) if r[12] else None
            
            results.append({
                "id": r[0],
                "role": r[1],
                "text": r[2],
                "sql": r[3],
                "columns": cols,
                "rows": rows,
                "executionTimeMs": r[6],
                "rowCount": r[7],
                "database": r[8],
                "error": r[9],
                "timestamp": r[10],
                "suggestedQuestions": sugs,
                "steps": steps
            })
        cursor.close()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to retrieve conversation messages: {e}")
    return results

# Automatically run initialization on import
init_audit_db()
