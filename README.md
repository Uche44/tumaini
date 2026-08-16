# 🌟 Tumaini (Hope) — Hear Hope From Your Future Self

> **Tumaini** means *hope* in Swahili. It is an AI-powered reflective experience designed to help you navigate today's struggles by hearing comforting, customized words of encouragement from a version of you who is 10 years in the future—spoken in **your own cloned voice**.

---

## 📸 Message Player Interface Design
The final playback dashboard is styled with a gorgeous, minimal, and warm editorial aesthetic:

![Tumaini Player Preview](screens/message.png)

---

## ✨ Features

- **🎙️ Step 01: Voice Cloning & Profile Management**
  - Record a 10–30 second voice clip directly in the browser or upload an audio file.
  - Generates an instant preview greeting to verify cloning accuracy.
  - Redesigned **Voice Reuse Dropdown** allowing users to select and delete previously recorded voice profiles, enabling multiple reflection journeys using the same cloned voice.
- **📝 Step 02: Story & Reflection Questionnaire**
  - Input your current situation, struggles, long-term aspirations, and custom reminders.
  - Choose personality traits (e.g., Anxious, Tired, Refined, Persistent) to shape the tone.
- **⚙️ Step 03: Generative Cascade**
  - **Persona Synthesis:** Generates a structured Future Self character (career milestones, resilience description) tailored to your goals.
  - **Script Writing:** Generates a raw, spoken-word monologue whisper from the future self—eschewing motivational clichés for quiet, raw, human tenderness.
  - **Audio Generation:** Synthesizes the monologue script into speech using the user's cloned voice profile.
- **🎵 Step 04: Ambient Audio Player**
  - A beautiful circular glassmorphic player card with a pulsing pink glow backdrop.
  - Custom timeline seeker progress indicator.
  - Playback controls including **Play/Pause**, **Skip Backward 10s**, and **Skip Forward 10s**.
  - A final comforting serif quote: *"You haven't met all of yourself yet."*

---

## 🛠️ Architecture & Stack

### Frontend (Next.js)
- **Framework:** Next.js 15 (App Router), React, TypeScript.
- **Styling:** Custom CSS design system ([globals.css](frontend/src/app/globals.css)) utilizing curated warm ivory, deep plum, and blush pink colors.
- **State Management:** React Context ([SessionContext](frontend/src/context/SessionContext.tsx)) to coordinate session states and voice IDs across routes.

### Backend (FastAPI)
- **Framework:** FastAPI, Python.
- **Database:** SQLite (local development) powered by SQLAlchemy.
- **Inference Engines:**
  - **LLM:** Hugging Face Serverless Inference API (running `Qwen/Qwen2.5-72B-Instruct` model) for generating personas and spoken scripts.
  - **TTS / Voice Cloning:** Gradium API for cloning voice samples and synthesizing monologue audio.

---

## 🚀 Getting Started

### 1. Backend Setup
1. Navigate to the backend folder:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```
3. Install the dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Create a `.env` file based on `.env.example`:
   ```ini
   PORT=8001
   DATABASE_URL=sqlite:///./tumaini.db
   HUGGINGFACE_API_KEY=your_huggingface_api_token
   GRADIUM_API_KEY=your_gradium_api_key
   FRONTEND_URL=http://localhost:3000
   ```
5. Run the server:
   ```bash
   uvicorn main:app --port 8001 --reload
   ```

### 2. Frontend Setup
1. Navigate to the frontend folder:
   ```bash
   cd ../frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env.local` file based on `.env.example`:
   ```ini
   NEXT_PUBLIC_API_BASE_URL=http://localhost:8001
   ```
4. Run the development server:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:3000](http://localhost:3000) in your browser.

