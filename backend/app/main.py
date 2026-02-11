from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.endpoints import search
from app.api.v1.endpoints import db_search
from app.core.config import settings

app = FastAPI(title=settings.PROJECT_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For MVP, allowing all. Change to specific origins in production.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(search.router, prefix="/api/v1/search", tags=["search"])
app.include_router(db_search.router, prefix="/api/v1", tags=["db-search"])

@app.get("/health")
def health_check():
    return {"status": "ok"}
