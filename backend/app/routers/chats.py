from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from app.logger import (
    db_save_conversation,
    db_delete_conversation,
    db_get_conversations,
    db_get_messages
)

router = APIRouter(prefix="/chats", tags=["chats"])

class ConversationCreateRequest(BaseModel):
    id: str
    title: str
    jdbc_url: Optional[str] = None

class ConversationUpdateRequest(BaseModel):
    title: str

@router.get("/conversations")
async def get_conversations(jdbc_url: Optional[str] = None):
    """Retrieves all active conversations for the admin user."""
    return db_get_conversations("admin", jdbc_url)

@router.post("/conversations")
async def create_conversation(req: ConversationCreateRequest):
    """Creates a new conversation record."""
    db_save_conversation(req.id, req.title, "admin", req.jdbc_url)
    return {"status": "success", "id": req.id}

@router.put("/conversations/{conversation_id}")
async def update_conversation(conversation_id: str, req: ConversationUpdateRequest):
    """Updates/renames a conversation title."""
    db_save_conversation(conversation_id, req.title, "admin")
    return {"status": "success"}

@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Deletes a conversation and all its messages."""
    db_delete_conversation(conversation_id)
    return {"status": "success"}

@router.get("/conversations/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: str):
    """Retrieves all message history for a given conversation."""
    return db_get_messages(conversation_id)
