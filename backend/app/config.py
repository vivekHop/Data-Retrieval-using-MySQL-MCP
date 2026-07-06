import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "Enterprise AI SQL Assistant"
    API_V1_STR: str = "/api/v1"
    
    # Gemini Configuration
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    
    # Database Settings
    DATABASE_URL: str = ""
    
    # Default UAT Connection Settings
    DEFAULT_JDBC_URL: str = ""
    DEFAULT_DB_USER: str = ""
    DEFAULT_DB_PASSWORD: str = ""
    
    # Query Settings
    QUERY_TIMEOUT_SECONDS: int = 15
    DEFAULT_QUERY_LIMIT: int = 100
    
    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()
