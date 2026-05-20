import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./nutrition_agent.db")
    FATSECRET_API_KEY: str = os.getenv("FATSECRET_API_KEY", "")
