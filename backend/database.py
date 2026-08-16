import logging
from sqlalchemy import create_engine, Column, Integer, String, DateTime, text
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime
from config import settings

db_logger = logging.getLogger("tumaini.db")

# For SQLite, enable check_same_thread=False for multi-threading in FastAPI requests
engine_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    engine_args["connect_args"] = {"check_same_thread": False}

engine = create_engine(settings.DATABASE_URL, **engine_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class VoiceProfile(Base):
    __tablename__ = "voice_profiles"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, unique=True, index=True)
    voice_id = Column(String, index=True)
    audio_path = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

class UserStory(Base):
    __tablename__ = "user_stories"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, unique=True, index=True)
    situation = Column(String)
    goals = Column(String)       # Stored as serialized JSON list of strings
    challenges = Column(String)
    traits = Column(String)      # Stored as serialized JSON list of strings
    reminders = Column(String)
    memory = Column(String)      # Optional: a specific memory the future self should remember
    for_whom = Column(String)    # Optional: the person they are doing this for
    created_at = Column(DateTime, default=datetime.utcnow)

class Persona(Base):
    __tablename__ = "personas"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, unique=True, index=True)
    name = Column(String)
    years_in_future = Column(Integer)
    career_path = Column(String)
    accomplishments = Column(String)  # Stored as serialized JSON list of strings
    resilience_description = Column(String)
    summary = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

class Script(Base):
    __tablename__ = "scripts"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, unique=True, index=True)
    script_text = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

class AudioGeneration(Base):
    __tablename__ = "audio_generations"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, unique=True, index=True)
    audio_path = Column(String)
    audio_url = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

def init_db():
    """Create database tables if they do not exist."""
    Base.metadata.create_all(bind=engine)
    _migrate_user_stories()

def _migrate_user_stories():
    """Add new optional columns to an existing SQLite user_stories table if missing."""
    try:
        with engine.connect() as conn:
            existing_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(user_stories)"))}
            for col_name in ("memory", "for_whom"):
                if col_name not in existing_cols:
                    conn.execute(text(f"ALTER TABLE user_stories ADD COLUMN {col_name} VARCHAR"))
                    db_logger.info(f"Added column '{col_name}' to user_stories.")
    except Exception as e:
        db_logger.warning(f"user_stories migration skipped: {e}")

def get_db():
    """Dependency for obtaining DB session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
