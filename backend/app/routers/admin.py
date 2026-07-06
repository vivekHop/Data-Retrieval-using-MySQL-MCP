from fastapi import APIRouter
from typing import List
from app.models import AuditLogEntry
from app.logger import get_audit_logs

router = APIRouter(prefix="/admin", tags=["admin"])

@router.get("/logs", response_model=List[AuditLogEntry])
async def get_audit_records(limit: int = 50):
    """Retrieves the recent execution history audit log."""
    return get_audit_logs(limit)
