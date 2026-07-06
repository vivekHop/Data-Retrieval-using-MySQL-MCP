import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from app.config import settings
from app.db import client_id_var
from app.routers import metadata, query, admin, chats

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Secure AI-powered query engine for SQL database schema extraction and natural query execution.",
    version="1.0.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def client_id_middleware(request: Request, call_next):
    """
    Inject the caller's identity so every code path in this request sees
    its own isolated DatabaseManager.

    Clients should send `X-Client-Id: <some-uuid>` header.
    If absent, falls back to their IP address so different browser tabs/users
    still get separate sessions.
    """
    client_id = (
        request.headers.get("X-Client-Id")
        or request.headers.get("x-client-id")
        or (request.client.host if request.client else "default")
    )
    token = client_id_var.set(client_id)
    try:
        response = await call_next(request)
        return response
    finally:
        client_id_var.reset(token)


# Routers
app.include_router(metadata.router, prefix=settings.API_V1_STR)
app.include_router(query.router, prefix=settings.API_V1_STR)
app.include_router(admin.router, prefix=settings.API_V1_STR)
app.include_router(chats.router, prefix=settings.API_V1_STR)


@app.on_event("startup")
async def startup_event():
    """
    Nothing to pre-connect on startup — each client establishes their own
    session when they hit the /connect endpoint or load the page.
    The Neon PostgreSQL audit/chat tables are initialised by logger.py on import.
    """
    pass


@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": settings.PROJECT_NAME,
        "note": "Each client session manages its own JDBC connection independently.",
        "gemini_api_key_set": bool(settings.GEMINI_API_KEY),
    }
