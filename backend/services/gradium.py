import os
import re
import json
import uuid
import logging
import httpx
import numpy as np
from config import settings

logger = logging.getLogger("tumaini.gradium")

class GradiumService:
    def __init__(self):
        self.api_key = settings.GRADIUM_API_KEY
        self.base_url = settings.GRADIUM_BASE_URL.rstrip("/")
        # Delivery tuning (see Gradium voice-settings docs: speed, expressiveness).
        self.padding_bonus = 2.3   # positive = slower, more deliberate
        self.temp = 0.85           # expressiveness variation (0 = deterministic)

    def clone_voice(self, audio_file_path: str, session_id: str) -> str:
        """
        Sends the voice sample clip to Gradium for voice cloning.
        Returns the cloned voice_id (uid).
        Falls back to a mock voice_id if the API key is not configured or the API request fails.
        """
        # Fall back to mock if API key is missing
        if not self.api_key:
            mock_id = f"mock-gradium-voice-{uuid.uuid4()}"
            logger.warning(
                f"GRADIUM_API_KEY is not set. Falling back to mock voice_id: {mock_id}"
            )
            return mock_id

        url = f"{self.base_url}/api/voices/"
        headers = {
            "x-api-key": self.api_key
        }
        
        # Prepare multipart form fields
        data = {
            "name": f"Tumaini Voice Clone {session_id}",
            "description": f"Cloned voice for session {session_id} in Tumaini Future Self simulator.",
            "language": "en"
        }

        try:
            with open(audio_file_path, "rb") as audio_file:
                # Gradium expects field name "audio_file"
                files = {
                    "audio_file": (os.path.basename(audio_file_path), audio_file, "audio/webm")
                }
                
                logger.info(f"Sending cloning request to Gradium: {url}")
                response = httpx.post(url, headers=headers, data=data, files=files, timeout=30.0)
                
                if response.status_code in (200, 201):
                    result = response.json()
                    # Gradium returns voice id in the "uid" field
                    voice_id = result.get("uid")
                    if voice_id:
                        logger.info(f"Successfully cloned voice with Gradium. Voice ID: {voice_id}")
                        return voice_id
                    else:
                        raise ValueError(f"Gradium response missing 'uid' field: {response.text}")
                else:
                    logger.error(
                        f"Gradium cloning API returned status {response.status_code}: {response.text}"
                    )
                    raise httpx.HTTPStatusError(
                        f"Gradium error: {response.status_code}", 
                        request=response.request, 
                        response=response
                    )
                    
        except Exception as e:
            mock_id = f"mock-gradium-voice-{uuid.uuid4()}"
            logger.error(
                f"Gradium voice cloning failed due to exception: {str(e)}. "
                f"Falling back to mock voice_id: {mock_id}"
            )
            return mock_id

    MAX_BREAKS = 10

    def _apply_prosody(self, text: str) -> str:
        """
        Converts spoken-pace markers into real Gradium <break ... /> tags and
        collapses line-wrapping whitespace. Punctuation is graded so the voice
        reads with genuinely varied rhythm rather than uniform pauses:
          - blank line (paragraph)   -> the longest pause
          - '...'                    -> hesitation pause
          - em-dash (—)              -> a short mid-thought dip

        Gradium renders a clean transcript (we store the raw script), while the
        audio gets genuine silences. Excess markers are demoted so pacing never
        turns robotic.
        """
        t = text.replace("\u2026", "...").strip()

        # Protect paragraph breaks (blank lines) with a sentinel so the
        # whitespace collapse below doesn't destroy them.
        t = re.sub(r"\n\s*\n+", "\x01", t)
        # Collapse remaining whitespace (single newlines are just line wrapping).
        t = re.sub(r"\s+", " ", t)

        count = {"n": 0}

        def _marker(break_tag, demote):
            def _repl(match):
                count["n"] += 1
                if count["n"] > self.MAX_BREAKS:
                    return demote
                return f" {break_tag} "
            return _repl

        t = re.sub("\x01", _marker(' <break time="0.8s" /> ', " "), t)
        t = re.sub(r"\s*\.\.\.\s*", _marker(' <break time="0.5s" /> ', ", "), t)
        t = re.sub(r"\s*(?:—|–)\s*", _marker(' <break time="0.25s" /> ', " "), t)
        return t.strip()

    def _split_paragraphs(self, text: str) -> list:
        parts = re.split(r"\n\s*\n+", (text or "").strip())
        return [p.strip() for p in parts if p.strip()]

    def _wav_to_samples(self, content: bytes):
        """Read WAV bytes into (int16 mono samples, sample_rate)."""
        import io
        import wave
        w = wave.open(io.BytesIO(content), "rb")
        sr = w.getframerate()
        ch = w.getnchannels()
        data = w.readframes(w.getnframes())
        w.close()
        arr = np.frombuffer(data, dtype=np.int16)
        if ch > 1:
            arr = arr.reshape(-1, ch).mean(axis=1).astype(np.int16)
        return arr, sr

    def _write_wav(self, samples, filepath: str, sr: int):
        import wave
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with wave.open(filepath, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(samples.astype("int16").tobytes())

    def _make_breath(self, sr: int, duration: float = 0.55, energy: float = 0.12):
        """
        A soft, breathy exhalation: low-passed noise shaped like a breath.
        Gives an audible inhale/exhale so human pacing includes real breathing
        sounds, not just silence.
        """
        rng = np.random.default_rng(1234)
        n = int(sr * duration)
        noise = rng.standard_normal(n)
        alpha = 1.0 - np.exp(-2.0 * np.pi * 900.0 / sr)
        filtered = np.empty_like(noise)
        acc = 0.0
        for i in range(n):
            acc += alpha * (noise[i] - acc)
            filtered[i] = acc
        t = np.linspace(0.0, duration, n)
        env = np.minimum(t / 0.10, 1.0) * np.exp(-t / 0.28)  # quick onset, long decay
        out = filtered * env
        peak = np.abs(out).max() + 1e-9
        return (out / peak * energy * 32767.0).astype(np.int16)

    def _synthesize_tts_paragraph(self, text: str, voice_id: str):
        """
        Synthesizes a single paragraph to (samples, sr). Returns None on failure.
        """
        url = f"{self.base_url}/api/post/speech/tts"
        headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json"
        }
        payload = {
            "text": self._apply_prosody(text),
            "voice_id": voice_id,
            "output_format": "wav",
            "only_audio": True
        }
        # Gradium REST accepts advanced voice settings as a URL-encoded JSON query param.
        params = {
            "json_config": json.dumps({
                "padding_bonus": self.padding_bonus,  # positive = slower, deliberate
                "temp": self.temp                     # expressiveness variation
            })
        }
        try:
            logger.info(f"Sending paragraph speech synthesis request to Gradium: {url}")
            response = httpx.post(url, headers=headers, json=payload, params=params, timeout=60.0)
            if response.status_code == 200:
                return self._wav_to_samples(response.content)
            logger.error(f"Gradium TTS returned status {response.status_code}: {response.text[:200]}")
        except Exception as e:
            logger.error(f"Gradium paragraph synthesis failed: {str(e)}")
        return None

    def synthesize_speech(self, text: str, voice_id: str, output_filepath: str) -> bool:
        """
        Synthesizes text into speech using Gradium TTS and saves as WAV.

        The script is synthesized one paragraph at a time and a soft audible
        breath is spliced between paragraphs, so the delivery has real
        breathing room instead of a uniform rush.
        Falls back to a mock (but paced) WAV if the API call fails or key is missing.
        """
        if not self.api_key or voice_id.startswith("mock-gradium-voice"):
            logger.warning("No Gradium API key or mock voice ID detected. Generating paced mock preview WAV.")
            self._synthesize_mock_paced(text, output_filepath)
            return True

        paragraphs = self._split_paragraphs(text) or [text]

        clips = []
        sr = None
        for i, para in enumerate(paragraphs):
            tts_text = para if i == 0 else f' <break time="0.5s" /> {para}'
            result = self._synthesize_tts_paragraph(tts_text, voice_id)
            if result is None:
                logger.warning("Gradium synthesis failed for a paragraph. Generating paced mock WAV instead.")
                self._synthesize_mock_paced(text, output_filepath)
                return True
            clips.append(result)
            sr = result[1]

        combined = clips[0][0]
        for i in range(1, len(clips)):
            combined = np.concatenate([combined, self._make_breath(sr), clips[i][0]])

        self._write_wav(combined, output_filepath, sr)
        logger.info(f"Successfully synthesized {len(clips)} paragraph(s) with breath pauses -> {output_filepath}")
        return True

    def _mock_samples(self, duration_sec: float = 3.0):
        sr = 44100
        n = int(duration_sec * sr)
        t = np.linspace(0.0, duration_sec, n, endpoint=False)
        vibrato = 8.0 * np.sin(2 * np.pi * 6.0 * t)
        freq = 180.0 + vibrato
        value = 14000.0 * (
            np.sin(2 * np.pi * freq * t) +
            0.4 * np.sin(2 * np.pi * (freq * 2.0) * t) +
            0.25 * np.sin(2 * np.pi * 90.0 * t)
        )
        return value.astype(np.int16), sr

    def _synthesize_mock_paced(self, text: str, output_filepath: str):
        """Mock WAVs that still mirror the paragraph/breath structure."""
        paragraphs = self._split_paragraphs(text) or [text]
        clips = []
        sr = None
        for para in paragraphs:
            n_words = max(4, len(para.split()))
            s, sr = self._mock_samples(min(6.0, n_words * 0.4))
            clips.append(s)
        combined = clips[0]
        for i in range(1, len(clips)):
            combined = np.concatenate([combined, self._make_breath(sr), clips[i]])
        self._write_wav(combined, output_filepath, sr)
        logger.info(f"Paced mock WAV created with {len(clips)} paragraph(s): {output_filepath}")

    def _create_mock_wav(self, filepath: str, duration_sec: float = 3.5):
        """
        Programmatically generates a modulated WAV file to mock cloned speech synthesis.
        """
        samples, sr = self._mock_samples(duration_sec)
        self._write_wav(samples, filepath, sr)
        logger.info(f"Programmatic mock WAV file created at: {filepath}")

gradium_service = GradiumService()
