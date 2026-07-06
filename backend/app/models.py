from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime

# Database Metadata Models
class ColumnMetadata(BaseModel):
    name: str
    data_type: str
    is_primary: bool = False
    is_foreign: bool = False
    referenced_table: Optional[str] = None
    referenced_column: Optional[str] = None

class TableMetadata(BaseModel):
    name: str
    columns: List[ColumnMetadata]
    primary_keys: List[str] = Field(default_factory=list)
    foreign_keys: List[Dict[str, str]] = Field(default_factory=list) # e.g. [{"column": "dept_id", "ref_table": "departments", "ref_column": "id"}]

class DatabaseMetadata(BaseModel):
    name: str
    tables: Dict[str, TableMetadata] = Field(default_factory=dict)

class RelationshipMetadata(BaseModel):
    source_table: str
    source_column: str
    target_table: str
    target_column: str

# Query Models
class NaturalQueryRequest(BaseModel):
    prompt: str
    database: Optional[str] = None # Legacy, optional database parameter
    selected_databases: Optional[List[str]] = None
    conversation_id: Optional[str] = None

class QueryResponse(BaseModel):
    success: bool
    summary: Optional[str] = None
    sql: Optional[str] = None
    columns: Optional[List[str]] = None
    rows: Optional[List[List[Any]]] = None
    execution_time_ms: float = 0.0
    row_count: int = 0
    database_used: Optional[str] = None
    error: Optional[str] = None
    suggested_questions: List[str] = Field(default_factory=list)
    steps: Optional[List[Dict[str, Any]]] = None
    gemini_calls_count: int = 0

# Logging & Admin Models
class AuditLogEntry(BaseModel):
    id: int
    user_id: str
    timestamp: str
    question: str
    generated_sql: Optional[str] = None
    database_used: Optional[str] = None
    execution_time_ms: float = 0.0
    status: str # "SUCCESS" or "FAILURE"
    error_message: Optional[str] = None

class JdbcConnectRequest(BaseModel):
    jdbc_url: str
    username: Optional[str] = None
    password: Optional[str] = None

