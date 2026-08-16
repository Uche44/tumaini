const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8001';

export interface HealthResponse {
  status: string;
  app: string;
  version: string;
  database: string;
  voice_provider?: string;
}

export interface VoiceUploadResponse {
  voice_id: string;
  provider: string;
  sample_audio_url: string;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = 'Something went wrong. Please try again.';
    try {
      const json = await res.json();
      if (json.detail) detail = json.detail;
    } catch {
      // ignore parse error, use default message
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

/**
 * Verify FastAPI + SQLite backend connectivity.
 */
export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE_URL}/health`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  return handleResponse<HealthResponse>(res);
}

/**
 * Upload voice recording blob to the backend for voice cloning.
 * Implemented in Milestone 7 — voice cloning endpoint wired to Voicebox.sh.
 *
 * @param blob - The recorded audio Blob
 * @returns voice_id from the voice provider (Voicebox.sh)
 */
export async function uploadVoice(blob: Blob, sessionId: string): Promise<VoiceUploadResponse> {
  const formData = new FormData();
  formData.append('audio', blob, 'voice_sample.webm');

  const res = await fetch(`${API_BASE_URL}/voice/clone`, {
    method: 'POST',
    headers: {
      'X-Session-ID': sessionId,
    },
    body: formData,
  });
  return handleResponse<VoiceUploadResponse>(res);
}

export interface UserStoryInput {
  situation: string;
  goals: string[];
  challenges: string;
  traits: string[];
  reminders?: string;
  memory?: string;
  forWhom?: string;
}

export interface BaseSuccessResponse {
  status: string;
  message: string;
}

/**
 * Persists the user's reflection story questions.
 */
export async function saveUserStory(
  story: {
    situation: string;
    goals: string[];
    challenges: string;
    traits: string[];
    reminders?: string;
    memory?: string;
    forWhom?: string;
  },
  sessionId: string
): Promise<BaseSuccessResponse> {
  const res = await fetch(`${API_BASE_URL}/story`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
    body: JSON.stringify({
      situation: story.situation,
      goals: story.goals,
      challenges: story.challenges,
      traits: story.traits,
      reminders: story.reminders,
      memory: story.memory,
      for_whom: story.forWhom,
    }),
  });
  return handleResponse<BaseSuccessResponse>(res);
}

export interface PersonaResponse {
  status: string;
  persona: {
    name: string;
    years_in_future: number;
    career_path: string;
    accomplishments: string[];
    resilience_description: string;
    summary: string;
  };
}

export interface ScriptResponse {
  status: string;
  script: string;
}

export interface AudioResponse {
  status: string;
  audio_url: string;
}

/**
 * Triggers LLM persona generation.
 */
export async function generatePersona(sessionId: string): Promise<PersonaResponse> {
  const res = await fetch(`${API_BASE_URL}/generation/persona`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
  });
  return handleResponse<PersonaResponse>(res);
}

/**
 * Triggers LLM script generation based on persona.
 */
export async function generateScript(sessionId: string): Promise<ScriptResponse> {
  const res = await fetch(`${API_BASE_URL}/generation/script`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
  });
  return handleResponse<ScriptResponse>(res);
}

/**
 * Triggers Gradium voice audio synthesis based on script.
 */
export async function generateAudio(sessionId: string): Promise<AudioResponse> {
  const res = await fetch(`${API_BASE_URL}/generation/audio`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
  });
  return handleResponse<AudioResponse>(res);
}

export interface SavedVoice {
  session_id: string;
  voice_id: string;
  audio_url: string;
  created_at: string | null;
}

export interface SavedVoicesResponse {
  status: string;
  voices: SavedVoice[];
}

/**
 * Fetches all saved voice profiles from database.
 */
export async function fetchSavedVoices(): Promise<SavedVoicesResponse> {
  const res = await fetch(`${API_BASE_URL}/voices`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return handleResponse<SavedVoicesResponse>(res);
}

/**
 * Registers voice reuse for a new session.
 */
export async function reuseVoice(voiceId: string, sessionId: string): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE_URL}/voices/reuse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
    body: JSON.stringify({ voice_id: voiceId }),
  });
  return handleResponse<{ status: string; message: string }>(res);
}

/**
 * Deletes a saved voice and all of its session mappings.
 */
export async function deleteVoice(voiceId: string): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE_URL}/voices/${voiceId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return handleResponse<{ status: string; message: string }>(res);
}
