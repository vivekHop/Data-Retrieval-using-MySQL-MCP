import httpx
import logging
import json
import uuid
import re
from typing import List, Dict, Any, Optional, AsyncGenerator
from app.config import settings
from app.mcp_server import get_databases, get_schema, get_relationships, execute_select
from app.models import QueryResponse
from app.logger import (
    log_query,
    db_save_conversation,
    db_save_message,
    db_get_messages
)

logger = logging.getLogger(__name__)

# ── Gemini tool declarations ──────────────────────────────────────────────────
GEMINI_TOOLS = [
    {
        "functionDeclarations": [
            {
                "name": "get_databases",
                "description": "Returns a list of all available databases in the system."
            },
            {
                "name": "get_schema",
                "description": "Returns the schema metadata for a specified database (tables, columns, types, primary/foreign keys).",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "database": {
                            "type": "STRING",
                            "description": "The name of the database to inspect (e.g., 'sales', 'finance')."
                        }
                    },
                    "required": ["database"]
                }
            },
            {
                "name": "get_relationships",
                "description": "Returns relationships (foreign key mappings) between tables inside a specific database.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "database": {
                            "type": "STRING",
                            "description": "The name of the database to inspect."
                        }
                    },
                    "required": ["database"]
                }
            },
            {
                "name": "execute_select",
                "description": "Executes a safe read-only SQL SELECT query. Returns rows. MUST only be called after finding the correct database, tables, and columns using other tools.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "sql": {
                            "type": "STRING",
                            "description": "The SELECT SQL query to execute. Must be valid MySQL syntax, strictly read-only."
                        }
                    },
                    "required": ["sql"]
                }
            }
        ]
    }
]

SYSTEM_INSTRUCTION = """
You are an expert AI SQL Assistant for an enterprise.
Your goal is to answer the user's questions by querying the MySQL databases.
To do this, you MUST follow these steps:
1. Call `get_databases` to find the available databases.
2. Inspect the schemas of relevant databases by calling `get_schema`.
3. If necessary, call `get_relationships` to find foreign key relationships.
4. Construct a read-only SELECT SQL query. Do not execute destructive queries (INSERT, UPDATE, DELETE, etc.).
5. Execute the query using `execute_select`.
6. Explain the results in concise, user-friendly business language.

Rules:
- Never make assumptions about table names or columns. Always inspect schemas first!
- Always qualify table names with the database prefix in your SQL queries (e.g., `sales.customers`).
- Return the explanation in clear business terms. Keep it concise.
- If you encounter an error (e.g., table not found), try checking the schema again, correcting the query, and re-running.
"""


def execute_tool_call(name: str, args: Dict[str, Any], selected_databases: Optional[List[str]] = None) -> Any:
    """Executes local DB actions based on Gemini function calls."""
    if name == "get_databases":
        all_dbs = get_databases()
        if selected_databases is not None:
            sel_set = {d.lower() for d in selected_databases}
            return [db for db in all_dbs if db.lower() in sel_set]
        return all_dbs
    elif name == "get_schema":
        db = args.get("database", "")
        if selected_databases is not None:
            sel_set = {d.lower() for d in selected_databases}
            if db.lower() not in sel_set:
                return {"error": f"Database '{db}' is not in the selected databases: {selected_databases}"}
        return get_schema(db)
    elif name == "get_relationships":
        db = args.get("database", "")
        if selected_databases is not None:
            sel_set = {d.lower() for d in selected_databases}
            if db.lower() not in sel_set:
                return {"error": f"Database '{db}' is not in the selected databases: {selected_databases}"}
        return get_relationships(db)
    elif name == "execute_select":
        sql = args.get("sql", "")
        return execute_select(sql)
    else:
        raise ValueError(f"Unknown tool: {name}")


def _sse(event: str, data: Any) -> str:
    """Format a Server-Sent Event string."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def run_gemini_tool_loop_streaming(
    user_prompt: str,
    conversation_id: str,
    username: str,
    selected_databases: Optional[List[str]] = None,
) -> AsyncGenerator[str, None]:
    """
    Streaming version of the Gemini ReAct loop.
    Yields SSE events in real-time as each step completes:
      event: step  — one timeline step object
      event: result — final QueryResponse payload
      event: error  — on fatal failure
    """
    if not settings.GEMINI_API_KEY:
        yield _sse("error", {"message": "GEMINI_API_KEY is not configured."})
        return

    timeline_steps: List[Dict[str, Any]] = []
    gemini_calls_count = 0

    def emit_step(title: str, description: str, status: str = "completed", **kwargs) -> Dict[str, Any]:
        step = {"title": title, "description": description, "status": status, **kwargs}
        timeline_steps.append(step)
        return step

    # Step 1: Query received
    step = emit_step("Query Submitted", f'User asked: "{user_prompt[:80]}"')
    yield _sse("step", step)

    # Load conversation history from Neon
    past_messages = db_get_messages(conversation_id)
    history = []
    for msg in past_messages:
        role = "user" if msg["role"] == "user" else "model"
        history.append({"role": role, "parts": [{"text": msg["text"]}]})

    # Save user message to DB immediately (so it's persisted even if AI fails)
    user_msg_id = str(uuid.uuid4())
    db_save_conversation(conversation_id, user_prompt[:50], username)
    db_save_message(user_msg_id, conversation_id, "user", user_prompt)

    # Append the new user prompt
    history.append({"role": "user", "parts": [{"text": user_prompt}]})

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{settings.GEMINI_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"
    )
    headers = {"Content-Type": "application/json"}

    last_sql = None
    last_db = None
    last_exec_time = 0.0
    last_row_count = 0
    last_columns: List[str] = []
    last_rows: List[List[Any]] = []
    last_error = None

    # Step 2: Contacting AI
    step = emit_step("Contacting Gemini AI", "Sending conversation history to Gemini for reasoning…")
    yield _sse("step", step)

    for turn in range(8):
        payload = {
            "contents": history,
            "tools": GEMINI_TOOLS,
            "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        }

        gemini_calls_count += 1
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(url, json=payload, headers=headers, timeout=45.0)
                response.raise_for_status()
                res_data = response.json()
            except Exception as e:
                err_msg = str(e)
                if hasattr(e, "response") and e.response:
                    err_msg += f" — {e.response.text}"
                step = emit_step("API Request Failed", f"Gemini API error: {err_msg}", "error")
                yield _sse("step", step)

                # Persist error assistant message
                asst_msg_id = str(uuid.uuid4())
                db_save_message(
                    asst_msg_id, conversation_id, "assistant",
                    f"Gemini API Error: {err_msg}",
                    error_message=err_msg, steps=timeline_steps,
                    gemini_calls_count=gemini_calls_count
                )
                yield _sse("error", {"message": f"Gemini API Error: {err_msg}", "steps": timeline_steps})
                return

        candidates = res_data.get("candidates", [])
        if not candidates:
            yield _sse("error", {"message": "Gemini returned no candidates.", "steps": timeline_steps})
            return

        content = candidates[0].get("content", {})
        parts = content.get("parts", [])
        history.append(content)

        function_calls = [p.get("functionCall") for p in parts if "functionCall" in p]

        if not function_calls:
            # ── Final text response ───────────────────────────────────────────
            final_text = "".join(p.get("text", "") for p in parts if "text" in p)

            step = emit_step("Synthesis & Response", f"Gemini synthesized the results into a business explanation. (Made {gemini_calls_count} Gemini calls)")
            yield _sse("step", step)

            # Suggested follow-up questions
            suggested = await generate_suggested_questions(user_prompt, final_text)

            # Persist assistant message with full timeline and results
            asst_msg_id = str(uuid.uuid4())
            db_save_message(
                msg_id=asst_msg_id,
                conversation_id=conversation_id,
                role="assistant",
                text=final_text,
                sql=last_sql,
                columns=last_columns,
                rows=last_rows,
                execution_time_ms=last_exec_time,
                row_count=last_row_count,
                database_used=last_db,
                error_message=last_error,
                suggested_questions=suggested,
                steps=timeline_steps,
                gemini_calls_count=gemini_calls_count
            )

            log_query(
                user_id=username,
                question=user_prompt,
                generated_sql=last_sql,
                database_used=last_db,
                execution_time_ms=last_exec_time,
                status="SUCCESS" if not last_error else "FAILURE",
                error_message=last_error,
            )

            result_payload = {
                "success": True,
                "summary": final_text,
                "sql": last_sql,
                "columns": last_columns,
                "rows": last_rows,
                "execution_time_ms": last_exec_time,
                "row_count": last_row_count,
                "database_used": last_db,
                "error": last_error,
                "suggested_questions": suggested,
                "steps": timeline_steps,
                "gemini_calls_count": gemini_calls_count
            }
            yield _sse("result", result_payload)
            return

        # ── Handle tool calls ─────────────────────────────────────────────────
        function_responses_parts = []
        for fc in function_calls:
            call_name = fc.get("name")
            call_args = fc.get("args", {})

            # Emit step BEFORE executing (so UI shows it as "in progress")
            step_desc = f"Args: {json.dumps(call_args)}" if call_args else "No arguments."
            step = emit_step(f"Tool Call: {call_name}", step_desc)
            yield _sse("step", step)

            try:
                tool_result = execute_tool_call(call_name, call_args, selected_databases)
            except Exception as e:
                logger.error(f"Tool error {call_name}: {e}")
                tool_result = {"error": str(e), "success": False}

            # Capture SQL execution stats
            if call_name == "execute_select":
                last_sql = call_args.get("sql")
                # Extract the DB name from the SQL (qualified table reference)
                db_match = re.search(r'\b([a-zA-Z_][a-zA-Z0-9_]*)\.', last_sql or "", re.IGNORECASE)
                last_db = db_match.group(1).lower() if db_match else "unknown"

                if tool_result.get("success"):
                    last_columns = tool_result.get("columns", [])
                    last_rows = tool_result.get("rows", [])
                    last_exec_time = tool_result.get("execution_time_ms", 0.0)
                    last_row_count = tool_result.get("row_count", 0)
                    last_error = None
                    step = emit_step(
                        "SQL Executed ✓",
                        f"Returned {last_row_count} rows in {last_exec_time:.1f}ms.",
                        sql=last_sql,
                        columns=last_columns,
                        rows=last_rows,
                        execution_time_ms=last_exec_time,
                        row_count=last_row_count,
                        database=last_db
                    )
                else:
                    last_error = tool_result.get("error")
                    step = emit_step(
                        "SQL Execution Failed",
                        f"Error: {last_error}",
                        "error",
                        sql=last_sql,
                        error=last_error,
                        database=last_db
                    )
                yield _sse("step", step)

            function_responses_parts.append({
                "functionResponse": {
                    "name": call_name,
                    "response": {"result": tool_result}
                }
            })

        history.append({"role": "function", "parts": function_responses_parts})

    # Max turns exceeded
    err_text = "AI exceeded maximum reasoning turns without returning a final response."
    step = emit_step("Coordinator Limit Reached", "Maximum loop iterations reached.", "error")
    yield _sse("step", step)

    asst_msg_id = str(uuid.uuid4())
    db_save_message(
        asst_msg_id, conversation_id, "assistant",
        err_text, sql=last_sql, error_message=err_text, steps=timeline_steps,
        gemini_calls_count=gemini_calls_count
    )

    yield _sse("error", {"message": err_text, "steps": timeline_steps})


async def generate_suggested_questions(question: str, final_response: str) -> List[str]:
    """Generates 3 relevant follow-up questions using Gemini."""
    if not settings.GEMINI_API_KEY:
        return []
    try:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{settings.GEMINI_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"
        )
        payload = {
            "contents": [{
                "role": "user",
                "parts": [{
                    "text": (
                        f"Based on this user query: '{question}' and this system answer: '{final_response}', "
                        "suggest exactly 3 short, relevant follow-up database questions "
                        "(as a JSON array of strings). Output format: [\"Q1\", \"Q2\", \"Q3\"]"
                    )
                }]
            }],
            "generationConfig": {"responseMimeType": "application/json"}
        }
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, timeout=10.0)
            response.raise_for_status()
            res_data = response.json()
            candidates = res_data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    questions = json.loads(parts[0].get("text", "[]").strip())
                    if isinstance(questions, list):
                        return [str(q) for q in questions[:3]]
    except Exception as e:
        logger.warning(f"Failed to generate follow-up questions: {e}")
    return []


# ── Legacy non-streaming wrapper (kept for backward compat if needed) ─────────
async def run_gemini_tool_loop(
    user_prompt: str,
    conversation_id: str,
    username: str,
    selected_databases: Optional[List[str]] = None,
) -> QueryResponse:
    """Collects the full streaming result and returns it as a QueryResponse."""
    final_result = None
    last_steps: List[Dict[str, Any]] = []
    error_msg = None

    async for event_str in run_gemini_tool_loop_streaming(
        user_prompt, conversation_id, username, selected_databases
    ):
        # Parse SSE events
        lines = event_str.strip().split("\n")
        event_type = None
        data_str = None
        for line in lines:
            if line.startswith("event: "):
                event_type = line[7:]
            elif line.startswith("data: "):
                data_str = line[6:]

        if not event_type or not data_str:
            continue

        try:
            data = json.loads(data_str)
        except json.JSONDecodeError:
            continue

        if event_type == "step":
            last_steps.append(data)
        elif event_type == "result":
            final_result = data
        elif event_type == "error":
            error_msg = data.get("message")
            last_steps = data.get("steps", last_steps)

    if final_result:
        return QueryResponse(**final_result)

    return QueryResponse(
        success=False,
        error=error_msg or "Unknown error during AI processing.",
        steps=last_steps,
    )
