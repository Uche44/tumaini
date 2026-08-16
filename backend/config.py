import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file if present
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

class Settings:
    PROJECT_NAME: str = "Tumaini API"
    VERSION: str = "0.1.0"
    PORT: int = int(os.getenv("PORT", "8001"))
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")
    
    # SQLite Database Configuration
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./tumaini.db")
    
    # External Provider Credentials
    HUGGINGFACE_API_KEY: str = os.getenv("HUGGINGFACE_API_KEY", "")
    HUGGINGFACE_MODEL_ID: str = os.getenv("HUGGINGFACE_MODEL_ID", "Qwen/Qwen2.5-72B-Instruct")
    # Serverless inference base URL. The legacy api-inference.huggingface.co host
    # currently has no DNS records; router.huggingface.co is its successor and is
    # OpenAI-compatible at {base}/v1/chat/completions.
    HUGGINGFACE_API_BASE: str = os.getenv("HUGGINGFACE_API_BASE", "https://router.huggingface.co")
    GRADIUM_API_KEY: str = os.getenv("GRADIUM_API_KEY", "")
    GRADIUM_BASE_URL: str = os.getenv("GRADIUM_BASE_URL", "https://api.gradium.ai")

settings = Settings()
