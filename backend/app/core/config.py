import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "ImoFinder API"
    SUPABASE_URL: str
    SUPABASE_KEY: str
    SCRAPE_DO_TOKEN: str
    
    class Config:
        env_file = ".env"

settings = Settings()
