from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from app.models import NaturalQueryRequest, QueryResponse
from app.gemini import run_gemini_tool_loop_streaming, run_gemini_tool_loop

router = APIRouter(prefix="/query", tags=["query"])


@router.post("/ask/stream")
async def ask_question_stream(request: NaturalQueryRequest):
    """
    Streaming SSE endpoint: emits real-time timeline step events and a final result.
    
    Event types:
      event: step   — {"title": str, "description": str, "status": str}
      event: result — full QueryResponse JSON
      event: error  — {"message": str}
    """
    if not request.prompt.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Prompt cannot be empty.",
        )

    conv_id = request.conversation_id or "default"

    # Enforce JDBC url isolation: conversation must belong to the active connection
    from app.logger import db_get_conversation_jdbc_url, get_active_base_url
    active_url = get_active_base_url()
    conv_url = db_get_conversation_jdbc_url(conv_id)
    if conv_url and conv_url != active_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"This conversation belongs to database '{conv_url}', "
                f"but you are connected to '{active_url}'. "
                "Please reconnect to the correct database."
            ),
        )

    async def event_generator():
        async for chunk in run_gemini_tool_loop_streaming(
            user_prompt=request.prompt,
            conversation_id=conv_id,
            username="admin",
            selected_databases=request.selected_databases,
        ):
            yield chunk

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable Nginx buffering
        },
    )


@router.post("/ask", response_model=QueryResponse)
async def ask_question(request: NaturalQueryRequest):
    """
    Non-streaming fallback endpoint: waits for the full AI loop and returns a single JSON response.
    """
    if not request.prompt.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Prompt cannot be empty.",
        )

    conv_id = request.conversation_id or "default"

    from app.logger import db_get_conversation_jdbc_url, get_active_base_url
    active_url = get_active_base_url()
    conv_url = db_get_conversation_jdbc_url(conv_id)
    if conv_url and conv_url != active_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"This conversation belongs to database '{conv_url}', "
                f"but you are connected to '{active_url}'."
            ),
        )

    result = await run_gemini_tool_loop(
        user_prompt=request.prompt,
        conversation_id=conv_id,
        username="admin",
        selected_databases=request.selected_databases,
    )
    return result
