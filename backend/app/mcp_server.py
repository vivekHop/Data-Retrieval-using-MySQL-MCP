import logging
from typing import List, Dict, Any, Optional
from app.db import db_manager  # proxy — auto-routes to per-client session
from app.validator import validate_and_limit_sql, SQLValidationError

logger = logging.getLogger(__name__)

# Core Python implementations of the MCP tools.
# These will be called by Gemini (via FastAPI as the coordinator)
# and can also be exposed through a standard MCP Server interface.

def get_databases() -> List[str]:
    """
    Returns a list of available databases.
    """
    try:
        return list(db_manager.metadata_cache.keys())
    except Exception as e:
        logger.error(f"Error in get_databases tool: {e}")
        return []

def get_schema(database: str) -> Dict[str, Any]:
    """
    Returns schema metadata for the given database, including tables, columns, types, primary keys, and foreign keys.
    """
    try:
        if database not in db_manager.metadata_cache:
            # Try to refresh and see if it appears
            db_manager.force_refresh_cache()
            if database not in db_manager.metadata_cache:
                return {"error": f"Database '{database}' not found."}
                
        db_meta = db_manager.metadata_cache[database]
        
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
                        "referenced_column": col.referenced_column
                    } for col in table_meta.columns
                ],
                "primary_keys": table_meta.primary_keys,
                "foreign_keys": table_meta.foreign_keys
            }
        return result
    except Exception as e:
        logger.error(f"Error in get_schema tool for {database}: {e}")
        return {"error": str(e)}

def get_relationships(database: str) -> List[Dict[str, str]]:
    """
    Returns the relationships (foreign key mappings) between tables in the specified database.
    """
    try:
        if database not in db_manager.metadata_cache:
            return []
            
        db_meta = db_manager.metadata_cache[database]
        relationships = []
        
        for table_name, table_meta in db_meta.tables.items():
            for fk in table_meta.foreign_keys:
                relationships.append({
                    "source_table": table_name,
                    "source_column": fk["column"],
                    "target_table": fk["ref_table"],
                    "target_column": fk["ref_column"]
                })
        return relationships
    except Exception as e:
        logger.error(f"Error in get_relationships tool for {database}: {e}")
        return []

def execute_select(sql: str) -> Dict[str, Any]:
    """
    Accepts a validated SELECT query and executes it against the database.
    Applies safety rules and limits output rows.
    """
    try:
        # Validate and apply limit
        safe_sql = validate_and_limit_sql(sql)
        
        # Execute query
        columns, rows, execution_time = db_manager.execute_query(safe_sql)
        
        return {
            "success": True,
            "sql_executed": safe_sql,
            "columns": columns,
            "rows": rows,
            "execution_time_ms": round(execution_time, 2),
            "row_count": len(rows)
        }
    except SQLValidationError as ve:
        logger.warning(f"SQL validation rejected query: {sql}. Error: {ve}")
        return {
            "success": False,
            "error": f"SQL Validation Error: {ve}",
            "sql_executed": sql
        }
    except Exception as e:
        logger.error(f"Error executing SELECT query: {sql}. Error: {e}")
        return {
            "success": False,
            "error": f"Database Error: {str(e)}",
            "sql_executed": sql
        }

# Optional integration with the official MCP library if the user imports it
MCP_SDK_INSTALLED = False
try:
    from mcp.server import Server
    import mcp.types as types
    
    mcp_app = Server("enterprise-sql-assistant")
    
    @mcp_app.list_tools()
    async def list_tools() -> List[types.Tool]:
        return [
            types.Tool(
                name="get_databases",
                description="List all available MySQL/SQLite databases.",
                inputSchema={
                    "type": "object",
                    "properties": {}
                }
            ),
            types.Tool(
                name="get_schema",
                description="Retrieve schema information for a specific database (tables, columns, types, keys).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "database": {"type": "string", "description": "The name of the database to inspect."}
                    },
                    "required": ["database"]
                }
            ),
            types.Tool(
                name="get_relationships",
                description="Retrieve relationships (foreign keys) between tables inside a specific database.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "database": {"type": "string", "description": "The name of the database to inspect."}
                    },
                    "required": ["database"]
                }
            ),
            types.Tool(
                name="execute_select",
                description="Execute a safe read-only SELECT SQL query and return rows.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "sql": {"type": "string", "description": "The SELECT SQL query to execute."}
                    },
                    "required": ["sql"]
                }
            )
        ]
        
    @mcp_app.call_tool()
    async def call_tool(name: str, arguments: dict) -> List[types.TextContent]:
        if name == "get_databases":
            res = get_databases()
            return [types.TextContent(type="text", text=str(res))]
        elif name == "get_schema":
            res = get_schema(arguments.get("database", ""))
            return [types.TextContent(type="text", text=str(res))]
        elif name == "get_relationships":
            res = get_relationships(arguments.get("database", ""))
            return [types.TextContent(type="text", text=str(res))]
        elif name == "execute_select":
            res = execute_select(arguments.get("sql", ""))
            return [types.TextContent(type="text", text=str(res))]
        else:
            raise ValueError(f"Tool {name} not found.")
            
    MCP_SDK_INSTALLED = True
except ImportError:
    pass
