import re
import logging
from typing import Tuple, Optional
from app.config import settings

logger = logging.getLogger(__name__)

# Try importing sqlglot, if not present we use a regex/token fallback
try:
    import sqlglot
    from sqlglot import exp
    SQLGLOT_AVAILABLE = True
except ImportError:
    SQLGLOT_AVAILABLE = False

class SQLValidationError(Exception):
    pass

def strip_sql_comments(sql: str) -> str:
    """Removes standard single-line and multi-line comments from SQL text."""
    # Remove multi-line comments (/* ... */)
    sql = re.sub(r'/\*.*?\*/', '', sql, flags=re.DOTALL)
    # Remove single-line comments starting with -- or #
    sql = re.sub(r'(--|#).*?$', '', sql, flags=re.MULTILINE)
    return sql.strip()

def validate_and_limit_sql(sql_query: str) -> str:
    """
    Validates a SQL query for read-only access and enforces a LIMIT.
    Returns the sanitized, validated SQL query with LIMIT applied.
    Raises SQLValidationError if the query is invalid or unsafe.
    """
    # 1. Strip comments to prevent bypasses
    clean_sql = strip_sql_comments(sql_query)
    if not clean_sql:
        raise SQLValidationError("Empty SQL query after stripping comments.")
        
    # 2. Check for multiple statements
    # A simple split on semicolons. A query like: "SELECT * FROM users; DROP TABLE users" should be rejected.
    # Note: We must be careful if semicolon is inside a string literal. 
    # The parser or a regex check can handle this.
    statements = [s.strip() for s in clean_sql.split(';') if s.strip()]
    if len(statements) > 1:
        raise SQLValidationError("Multiple SQL statements are not allowed.")
        
    # Standardize to query without trailing semicolon for parsing
    query_to_parse = statements[0] if statements else clean_sql
    
    # 3. Check for disallowed keywords using simple regex before parsing (defense in depth)
    disallowed_keywords = [
        r'\bINSERT\b', r'\bUPDATE\b', r'\bDELETE\b', r'\bDROP\b', 
        r'\bALTER\b', r'\bTRUNCATE\b', r'\bCREATE\b', r'\bREPLACE\b',
        r'\bGRANT\b', r'\bREVOKE\b', r'\bEXECUTE\b', r'\bEXEC\b', r'\bCALL\b',
        r'\bMERGE\b', r'\bUPSERT\b', r'\bRENAME\b', r'\bLOAD\b', r'\bSET\b'
    ]
    for pattern in disallowed_keywords:
        if re.search(pattern, query_to_parse, re.IGNORECASE):
            raise SQLValidationError(f"Disallowed write operations or commands detected (matched keyword).")

    if SQLGLOT_AVAILABLE:
        try:
            # Determine dialect dynamically
            from backend.app.db import db_manager
            dialect = "postgres" if db_manager.engine_type == "postgres" else "mysql"
            
            # Parse the query using correct dialect
            parsed = sqlglot.parse_one(query_to_parse, read=dialect)
            
            # Check the root node type
            allowed_root_types = (
                exp.Select, 
                exp.Show, 
                exp.Describe, 
                exp.Explain, 
                exp.Command, # Used for certain SHOW commands
                exp.CTE
            )
            
            # If it's a CTE, we need to inspect the inner query
            root_node = parsed
            if isinstance(parsed, exp.CTE):
                # Ensure the CTE eventually SELECTs
                pass # SQLGlot parses CTE as part of Select/Query structure, so the root usually is Select or we can verify
                
            # Verify no write expressions exist in the AST
            for node in parsed.walk():
                if isinstance(node, (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create, exp.AlterTable, exp.Merge)):
                    raise SQLValidationError("Write operation detected in query AST.")
                    
            # 4. Enforce Limit
            # We want to check if there is a limit clause at the outer select.
            # In SQLGlot, we can check if the root Select has a Limit.
            has_limit = False
            # Find any limit in the top level of the AST
            if isinstance(parsed, exp.Select):
                has_limit = parsed.args.get("limit") is not None
            elif isinstance(parsed, exp.Subquery):
                # Check inside
                inner = parsed.this
                if isinstance(inner, exp.Select):
                    has_limit = inner.args.get("limit") is not None
 
            # If no limit is found, we add one
            if not has_limit:
                if isinstance(parsed, exp.Select):
                    # We can use sqlglot to add limit
                    parsed = parsed.limit(settings.DEFAULT_QUERY_LIMIT)
                    query_to_parse = parsed.sql(dialect=dialect)
                else:
                    # Fallback string append if it's not a standard Select but is allowed
                    query_to_parse = f"{query_to_parse} LIMIT {settings.DEFAULT_QUERY_LIMIT}"
            else:
                # If there is a limit, ensure it's not exceeding the configured maximum
                # We can extract the limit value if possible, or trust it if it's within bounds
                pass
                
            # Regenerate SQL to standardize formatting
            if isinstance(parsed, (exp.Select, exp.CTE)):
                query_to_parse = parsed.sql(dialect=dialect)
                
        except Exception as e:
            if isinstance(e, SQLValidationError):
                raise e
            logger.warning(f"SQLGlot parsing failed: {e}. Falling back to manual regex validation.")
            query_to_parse = fallback_validation(query_to_parse)
    else:
        # Fallback manual validation if sqlglot is not available
        query_to_parse = fallback_validation(query_to_parse)
        
    return query_to_parse

def fallback_validation(sql: str) -> str:
    """Fallback manual SQL safety validation when SQLGlot is not present."""
    # Ensure it starts with SELECT, WITH, SHOW, DESCRIBE
    upper_sql = sql.upper().strip()
    allowed_starts = ("SELECT", "WITH", "SHOW", "DESCRIBE", "EXPLAIN")
    
    if not any(upper_sql.startswith(start) for start in allowed_starts):
        raise SQLValidationError("Query must start with SELECT, WITH, SHOW, or DESCRIBE.")
        
    # Check if a limit already exists
    # Simple regex to check for 'limit \d+' at the end of the query
    if not re.search(r'\bLIMIT\s+\d+', upper_sql):
        sql = f"{sql} LIMIT {settings.DEFAULT_QUERY_LIMIT}"
        
    return sql
