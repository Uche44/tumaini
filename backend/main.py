import logging
import os
import shutil
import json
from typing import List, Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, UploadFile, File, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import settings
from database import init_db, get_db, VoiceProfile, UserStory, Persona, Script, AudioGeneration
from services.gradium import gradium_service
from services.llm import llm_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tumaini")

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
GREETINGS_DIR = os.path.join(STATIC_DIR, "greetings")
GENERATIONS_DIR = os.path.join(STATIC_DIR, "generations")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Tumaini backend & SQLite database...")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(GREETINGS_DIR, exist_ok=True)
    os.makedirs(GENERATIONS_DIR, exist_ok=True)
    init_db()
    logger.info("Database initialized successfully.")
    yield
    logger.info("Shutting down Tumaini backend...")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan
)

# CORS configuration for Next.js frontend
origins = [
    settings.FRONTEND_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.post("/voice/clone")
async def upload_and_clone_voice(
    audio: UploadFile = File(...),
    x_session_id: str = Header(..., alias="X-Session-ID"),
    db: Session = Depends(get_db)
):
    """
    Saves the user's recorded audio sample, forwards it to Cartesia
    to clone their voice, and stores the voice profile ID mapping.
    """
    logger.info(f"Received voice clone request. Session ID: {x_session_id}")
    
    # Simple validation on audio file content type/size
    if not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Invalid file type. Must be an audio recording.")

    # Generate unique filename for caching
    file_ext = os.path.splitext(audio.filename)[1] or ".webm"
    local_filename = f"voice_{x_session_id}_{int(os.path.getmtime(__file__))}{file_ext}"
    local_filepath = os.path.join(UPLOAD_DIR, local_filename)

    try:
        # Save audio file to disk
        with open(local_filepath, "wb") as buffer:
            shutil.copyfileobj(audio.file, buffer)
        
        logger.info(f"Saved raw voice clip to {local_filepath}")
        
        # Clone voice via Gradium service
        voice_id = gradium_service.clone_voice(local_filepath, x_session_id)
        
        # Generate greeting voice preview clip
        greeting_filename = f"greeting_{x_session_id}.wav"
        greeting_filepath = os.path.join(GREETINGS_DIR, greeting_filename)
        
        logger.info(f"Synthesizing greeting preview for session {x_session_id}")
        greeting_text = "Hello, I am your future self. I'm glad you reached out. It's nice to hear my own voice again."
        gradium_service.synthesize_speech(greeting_text, voice_id, greeting_filepath)
        
        # Save or update mapping in SQLite
        existing_profile = db.query(VoiceProfile).filter(VoiceProfile.session_id == x_session_id).first()
        if existing_profile:
            logger.info(f"Updating existing voice profile for session {x_session_id}")
            # Clean up old file if it exists
            if existing_profile.audio_path and os.path.exists(existing_profile.audio_path):
                try:
                    os.remove(existing_profile.audio_path)
                except Exception as e:
                    logger.warning(f"Could not remove old audio file {existing_profile.audio_path}: {e}")
            existing_profile.voice_id = voice_id
            existing_profile.audio_path = local_filepath
        else:
            logger.info(f"Creating new voice profile for session {x_session_id}")
            new_profile = VoiceProfile(
                session_id=x_session_id,
                voice_id=voice_id,
                audio_path=local_filepath
            )
            db.add(new_profile)
            
        db.commit()
        
        return {
            "voice_id": voice_id,
            "provider": "gradium",
            "sample_audio_url": f"/static/greetings/{greeting_filename}"
        }
        
    except Exception as e:
        logger.error(f"Failed to clone voice sample: {str(e)}")
        # Clean up local file on failure
        if os.path.exists(local_filepath):
            try:
                os.remove(local_filepath)
            except Exception:
                pass
        raise HTTPException(
            status_code=502, 
            detail="An error occurred while creating your voice profile. Please try again."
        )

@app.get("/")
def read_root():
    return {
        "message": "Welcome to Tumaini API",
        "docs": "/docs"
    }

class UserStoryCreate(BaseModel):
    situation: str
    goals: List[str]
    challenges: str
    traits: List[str]
    reminders: Optional[str] = ""
    memory: Optional[str] = ""
    for_whom: Optional[str] = ""

@app.post("/story")
async def save_user_story(
    story_data: UserStoryCreate,
    x_session_id: str = Header(..., alias="X-Session-ID"),
    db: Session = Depends(get_db)
):
    """
    Saves or updates the user's reflection story (situation, goals, challenges, traits, and reminders)
    linked to their session ID.
    """
    logger.info(f"Received user story save request for session {x_session_id}")
    
    # Validation: ensure text inputs are not empty
    if not story_data.situation.strip():
        raise HTTPException(status_code=400, detail="Situation field cannot be empty.")
    if not story_data.challenges.strip():
        raise HTTPException(status_code=400, detail="Challenges field cannot be empty.")
    if not story_data.goals:
        raise HTTPException(status_code=400, detail="At least one goal must be provided.")
    if not story_data.traits:
        raise HTTPException(status_code=400, detail="At least one personality trait must be selected.")

    # Serialize list to JSON string for database storage
    goals_json = json.dumps([g.strip() for g in story_data.goals if g.strip()])
    traits_json = json.dumps([t.strip() for t in story_data.traits if t.strip()])

    try:
        existing_story = db.query(UserStory).filter(UserStory.session_id == x_session_id).first()
        if existing_story:
            logger.info(f"Updating user story for session {x_session_id}")
            existing_story.situation = story_data.situation
            existing_story.goals = goals_json
            existing_story.challenges = story_data.challenges
            existing_story.traits = traits_json
            existing_story.reminders = story_data.reminders
            existing_story.memory = story_data.memory
            existing_story.for_whom = story_data.for_whom
        else:
            logger.info(f"Creating new user story for session {x_session_id}")
            new_story = UserStory(
                session_id=x_session_id,
                situation=story_data.situation,
                goals=goals_json,
                challenges=story_data.challenges,
                traits=traits_json,
                reminders=story_data.reminders,
                memory=story_data.memory,
                for_whom=story_data.for_whom
            )
            db.add(new_story)
            
        db.commit()
        return {
            "status": "success",
            "message": "User story recorded successfully."
        }
    except Exception as e:
        logger.error(f"Failed to save user story: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save reflection answers. Please try again.")

@app.post("/generation/persona")
async def generate_future_self_persona(
    x_session_id: str = Header(..., alias="X-Session-ID"),
    db: Session = Depends(get_db)
):
    """
    Retrieves the user's story from the database, triggers LLM persona generation,
    persists the structured Future Self details, and returns the persona.
    """
    logger.info(f"Received persona generation request for session {x_session_id}")
    
    # 1. Fetch UserStory
    story = db.query(UserStory).filter(UserStory.session_id == x_session_id).first()
    if not story:
        raise HTTPException(
            status_code=404, 
            detail="Reflection story not found for this session. Please fill in Step 2."
        )

    # 2. Parse goals and traits from stored JSON
    try:
        goals = json.loads(story.goals)
        traits = json.loads(story.traits)
    except Exception as parse_err:
        logger.error(f"Error parsing stored story data: {parse_err}")
        goals = []
        traits = []

    # 3. Generate Persona via LLM
    persona_data = llm_service.generate_persona(
        situation=story.situation,
        goals=goals,
        challenges=story.challenges,
        traits=traits,
        memory=story.memory or "",
        for_whom=story.for_whom or ""
    )

    # 4. Save to database personas table
    try:
        existing_persona = db.query(Persona).filter(Persona.session_id == x_session_id).first()
        
        # Serialize achievements list
        accomplishments_json = json.dumps(persona_data.get("accomplishments", []))
        
        if existing_persona:
            logger.info(f"Updating existing persona for session {x_session_id}")
            existing_persona.name = persona_data.get("name", "Your Future Self")
            existing_persona.years_in_future = int(persona_data.get("years_in_future", 10))
            existing_persona.career_path = persona_data.get("career_path", "")
            existing_persona.accomplishments = accomplishments_json
            existing_persona.resilience_description = persona_data.get("resilience_description", "")
            existing_persona.summary = persona_data.get("summary", "")
        else:
            logger.info(f"Creating new persona for session {x_session_id}")
            new_persona = Persona(
                session_id=x_session_id,
                name=persona_data.get("name", "Your Future Self"),
                years_in_future=int(persona_data.get("years_in_future", 10)),
                career_path=persona_data.get("career_path", ""),
                accomplishments=accomplishments_json,
                resilience_description=persona_data.get("resilience_description", ""),
                summary=persona_data.get("summary", "")
            )
            db.add(new_persona)
            
        db.commit()
        
        return {
            "status": "success",
            "persona": persona_data
        }
    except Exception as db_err:
        logger.error(f"Database save persona failed: {db_err}")
        db.rollback()
        raise HTTPException(
            status_code=500, 
            detail="Failed to record your Future Self persona. Please try again."
        )

@app.post("/generation/script")
async def generate_future_self_script(
    x_session_id: str = Header(..., alias="X-Session-ID"),
    db: Session = Depends(get_db)
):
    """
    Retrieves the UserStory and Persona for the active session, generates a first-person
    encouragement script/letter from the Future Self, and stores it in SQLite.
    """
    logger.info(f"Received script generation request for session {x_session_id}")
    
    # 1. Fetch UserStory
    story = db.query(UserStory).filter(UserStory.session_id == x_session_id).first()
    if not story:
        raise HTTPException(
            status_code=404, 
            detail="Reflection story not found. Please complete Step 2 first."
        )

    # 2. Fetch Persona
    persona_row = db.query(Persona).filter(Persona.session_id == x_session_id).first()
    if not persona_row:
        raise HTTPException(
            status_code=404, 
            detail="Future Self persona not found. Please generate the persona first."
        )

    # Convert database Persona row to dictionary to pass to LLMService
    persona_dict = {
        "name": persona_row.name,
        "years_in_future": persona_row.years_in_future,
        "career_path": persona_row.career_path,
        "accomplishments": json.loads(persona_row.accomplishments),
        "resilience_description": persona_row.resilience_description,
        "summary": persona_row.summary
    }

    try:
        goals = json.loads(story.goals)
        traits = json.loads(story.traits)
    except Exception as parse_err:
        logger.error(f"Error parsing story lists: {parse_err}")
        goals = []
        traits = []

    # 3. Generate script via LLM service
    script_text = llm_service.generate_script(
        situation=story.situation,
        goals=goals,
        challenges=story.challenges,
        traits=traits,
        reminders=story.reminders or "",
        persona=persona_dict,
        memory=story.memory or "",
        for_whom=story.for_whom or ""
    )

    # 4. Save to database scripts table
    try:
        existing_script = db.query(Script).filter(Script.session_id == x_session_id).first()
        if existing_script:
            logger.info(f"Updating existing script for session {x_session_id}")
            existing_script.script_text = script_text
        else:
            logger.info(f"Creating new script for session {x_session_id}")
            new_script = Script(
                session_id=x_session_id,
                script_text=script_text
            )
            db.add(new_script)
            
        db.commit()
        
        return {
            "status": "success",
            "script": script_text
        }
    except Exception as db_err:
        logger.error(f"Database save script failed: {db_err}")
        db.rollback()
        raise HTTPException(
            status_code=500, 
            detail="Failed to record your Future Self script. Please try again."
        )

@app.post("/generation/audio")
async def generate_future_self_audio(
    x_session_id: str = Header(..., alias="X-Session-ID"),
    db: Session = Depends(get_db)
):
    """
    Retrieves the VoiceProfile (for voice_id) and Script for the active session,
    calls Gradium TTS to synthesize the message, and stores it in SQLite.
    """
    logger.info(f"Received speech audio generation request for session {x_session_id}")
    
    # 1. Fetch VoiceProfile
    profile = db.query(VoiceProfile).filter(VoiceProfile.session_id == x_session_id).first()
    if not profile:
        raise HTTPException(
            status_code=404, 
            detail="Voice profile not found. Please complete Step 1 first."
        )

    # 2. Fetch Script
    script_row = db.query(Script).filter(Script.session_id == x_session_id).first()
    if not script_row:
        raise HTTPException(
            status_code=404, 
            detail="Message script not found. Please generate the persona and script first."
        )

    # 3. Define output path
    audio_filename = f"message_{x_session_id}.wav"
    audio_filepath = os.path.join(GENERATIONS_DIR, audio_filename)
    audio_url = f"/static/generations/{audio_filename}"

    # 4. Call Gradium synthesis
    logger.info(f"Synthesizing script for session {x_session_id} using voice_id {profile.voice_id}")
    success = gradium_service.synthesize_speech(
        text=script_row.script_text,
        voice_id=profile.voice_id,
        output_filepath=audio_filepath
    )

    if not success:
        raise HTTPException(
            status_code=502,
            detail="Failed to synthesize Future Self voice message. Please try again."
        )

    # 5. Save to database audio_generations table
    try:
        existing_audio = db.query(AudioGeneration).filter(AudioGeneration.session_id == x_session_id).first()
        if existing_audio:
            logger.info(f"Updating existing audio generation for session {x_session_id}")
            existing_audio.audio_path = audio_filepath
            existing_audio.audio_url = audio_url
        else:
            logger.info(f"Creating new audio generation for session {x_session_id}")
            new_audio = AudioGeneration(
                session_id=x_session_id,
                audio_path=audio_filepath,
                audio_url=audio_url
            )
            db.add(new_audio)
            
        db.commit()
        
        return {
            "status": "success",
            "audio_url": audio_url
        }
    except Exception as db_err:
        logger.error(f"Database save audio generation failed: {db_err}")
        db.rollback()
        raise HTTPException(
            status_code=500, 
            detail="Failed to record your Future Self audio metadata. Please try again."
        )

@app.get("/voices")
def get_saved_voices(db: Session = Depends(get_db)):
    """
    Returns a list of saved voice clones, deduplicated by voice_id.

    Reusing a voice creates a new VoiceProfile row (new session -> same voice_id),
    so rows are collapsed into a single entry per unique voice_id. The row with a
    real greeting clip on disk wins; newest wins ties.
    """
    logger.info("Fetching all saved voice profiles...")
    try:
        profiles = db.query(VoiceProfile).order_by(VoiceProfile.created_at.asc()).all()

        unique: dict[str, tuple[VoiceProfile, bool]] = {}
        for p in profiles:
            greeting = os.path.join(GREETINGS_DIR, f"greeting_{p.session_id}.wav")
            has_clip = os.path.exists(greeting)
            current = unique.get(p.voice_id)
            if current is None:
                unique[p.voice_id] = (p, has_clip)
                continue
            prev, prev_clip = current
            if has_clip and not prev_clip:
                unique[p.voice_id] = (p, has_clip)
            elif has_clip == prev_clip and (not prev.created_at or (p.created_at and p.created_at > prev.created_at)):
                unique[p.voice_id] = (p, has_clip)

        voices_list = []
        for voice_id, (p, _) in unique.items():
            audio_url = f"/static/greetings/greeting_{p.session_id}.wav"
            voices_list.append({
                "session_id": p.session_id,
                "voice_id": voice_id,
                "audio_url": audio_url,
                "created_at": p.created_at.isoformat() if p.created_at else None
            })

        voices_list.sort(key=lambda v: v["created_at"] or "", reverse=True)
        return {
            "status": "success",
            "voices": voices_list
        }
    except Exception as e:
        logger.error(f"Failed to fetch saved voices: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch saved voices.")

class VoiceReuseRequest(BaseModel):
    voice_id: str

@app.post("/voices/reuse")
async def reuse_voice(
    reuse_data: VoiceReuseRequest,
    x_session_id: str = Header(..., alias="X-Session-ID"),
    db: Session = Depends(get_db)
):
    """
    Associates an existing voice_id with a new session_id by creating/updating a VoiceProfile row.
    """
    logger.info(f"Reusing voice_id {reuse_data.voice_id} for session {x_session_id}")
    try:
        existing_profile = db.query(VoiceProfile).filter(VoiceProfile.session_id == x_session_id).first()
        if existing_profile:
            existing_profile.voice_id = reuse_data.voice_id
        else:
            orig = db.query(VoiceProfile).filter(VoiceProfile.voice_id == reuse_data.voice_id).first()
            audio_path = orig.audio_path if orig else None
            new_profile = VoiceProfile(
                session_id=x_session_id,
                voice_id=reuse_data.voice_id,
                audio_path=audio_path
            )
            db.add(new_profile)
        db.commit()
        return {"status": "success", "message": "Voice reuse registered successfully."}
    except Exception as e:
        logger.error(f"Failed to register voice reuse: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to register voice reuse.")

@app.delete("/voices/{voice_id}")
def delete_saved_voice(voice_id: str, db: Session = Depends(get_db)):
    """
    Removes a cloned voice and all of its session mappings, then best-effort
    deletes the associated sample and greeting audio files from disk.
    """
    logger.info(f"Deleting voice profile(s) for voice_id {voice_id}")
    try:
        rows = db.query(VoiceProfile).filter(VoiceProfile.voice_id == voice_id).all()
        if not rows:
            raise HTTPException(status_code=404, detail="Voice not found.")

        session_ids = [r.session_id for r in rows]
        audio_paths = {r.audio_path for r in rows if r.audio_path}

        for r in rows:
            db.delete(r)
        db.commit()

        # Clean up files best-effort
        for sid in session_ids:
            greeting = os.path.join(GREETINGS_DIR, f"greeting_{sid}.wav")
            try:
                if os.path.exists(greeting):
                    os.remove(greeting)
            except Exception as e:
                logger.warning(f"Could not remove greeting file {greeting}: {e}")
        for path in audio_paths:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception as e:
                logger.warning(f"Could not remove sample file {path}: {e}")

        return {
            "status": "success",
            "deleted": len(rows),
            "message": "Voice deleted successfully."
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete voice: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete voice.")

@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    return {
        "status": "ok",
        "app": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "database": "sqlite_connected",
        "voice_provider": "gradium"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.PORT, reload=True)
