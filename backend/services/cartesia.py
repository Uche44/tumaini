import os
import uuid
import logging
import httpx
from config import settings

logger = logging.getLogger("tumaini.cartesia")

class CartesiaService:
    def __init__(self):
        self.api_key = settings.CARTESIA_API_KEY
        self.base_url = settings.CARTESIA_BASE_URL.rstrip("/")
        self.version = settings.CARTESIA_VERSION

    def clone_voice(self, audio_file_path: str, session_id: str) -> str:
        """
        Sends the voice sample clip to Cartesia for voice cloning.
        Returns the cloned voice_id.
        Falls back to a mock voice_id if the API key is not configured or the API request fails.
        """
        # If API key is not configured, fall back to mock immediately
        if not self.api_key:
            mock_id = f"mock-voice-{uuid.uuid4()}"
            logger.warning(
                f"CARTESIA_API_KEY is not set. Falling back to mock voice_id: {mock_id}"
            )
            return mock_id

        url = f"{self.base_url}/voices/clone"
        headers = {
            "X-API-Key": self.api_key,
            "Cartesia-Version": self.version
        }
        
        # Prepare multipart form fields
        data = {
            "name": f"Tumaini Voice Clone {session_id}",
            "description": f"Cloned voice for session {session_id} in Tumaini Future Self simulator.",
            "access[type]": "private"
        }

        try:
            # Open audio file in binary mode
            with open(audio_file_path, "rb") as audio_file:
                files = {
                    "clip": (os.path.basename(audio_file_path), audio_file, "audio/webm")
                }
                
                logger.info(f"Sending cloning request to Cartesia: {url}")
                # We use a 30s timeout since voice cloning can take a few seconds
                response = httpx.post(url, headers=headers, data=data, files=files, timeout=30.0)
                
                if response.status_code == 200 or response.status_code == 201:
                    result = response.json()
                    voice_id = result.get("id")
                    if voice_id:
                        logger.info(f"Successfully cloned voice with Cartesia. Voice ID: {voice_id}")
                        return voice_id
                    else:
                        raise ValueError(f"Cartesia response missing 'id' field: {response.text}")
                else:
                    logger.error(
                        f"Cartesia cloning API returned status {response.status_code}: {response.text}"
                    )
                    raise httpx.HTTPStatusError(
                        f"Cartesia error: {response.status_code}", 
                        request=response.request, 
                        response=response
                    )
                    
        except Exception as e:
            # Graceful fallback to mock voice_id in case of any network/API errors
            mock_id = f"mock-voice-{uuid.uuid4()}"
            logger.error(
                f"Cartesia voice cloning failed due to exception: {str(e)}. "
                f"Falling back to mock voice_id: {mock_id}"
            )
            return mock_id

    def synthesize_speech(self, text: str, voice_id: str, output_filepath: str) -> bool:
        """
        Synthesizes text into speech using Cartesia TTS endpoint and saves as WAV.
        Falls back to programmatic mock WAV generation if the API call fails or key is missing.
        """
        if not self.api_key or voice_id.startswith("mock-voice"):
            logger.warning("No Cartesia API key or mock voice ID detected. Generating mock preview WAV.")
            self._create_mock_wav(output_filepath)
            return True

        url = f"{self.base_url}/tts/bytes"
        headers = {
            "X-API-Key": self.api_key,
            "Cartesia-Version": self.version,
            "Content-Type": "application/json"
        }
        
        payload = {
            "model_id": "sonic-3.5",
            "transcript": text,
            "voice": {
                "mode": "id",
                "id": voice_id
            },
            "output_format": {
                "container": "wav",
                "encoding": "pcm_s16le",
                "sample_rate": 44100
            }
        }

        try:
            logger.info(f"Sending speech synthesis request to Cartesia: {url}")
            response = httpx.post(url, headers=headers, json=payload, timeout=30.0)
            
            if response.status_code == 200:
                with open(output_filepath, "wb") as f:
                    f.write(response.content)
                logger.info(f"Successfully synthesized audio and saved to {output_filepath}")
                return True
            else:
                logger.error(f"Cartesia TTS API returned status {response.status_code}: {response.text}")
                raise httpx.HTTPStatusError(f"Cartesia error: {response.status_code}", request=response.request, response=response)
                
        except Exception as e:
            logger.error(f"Cartesia speech synthesis failed: {str(e)}. Falling back to mock WAV generation.")
            self._create_mock_wav(output_filepath)
            return True

    def _create_mock_wav(self, filepath: str, duration_sec: float = 3.5):
        """
        Programmatically generates a modulated WAV file to mock cloned speech synthesis.
        """
        import wave
        import math
        import struct

        sample_rate = 44100
        num_samples = int(duration_sec * sample_rate)

        # Ensure directory exists
        os.makedirs(os.path.dirname(filepath), exist_ok=True)

        with wave.open(filepath, 'wb') as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit (2 bytes)
            wav_file.setframerate(sample_rate)

            for i in range(num_samples):
                t = float(i) / sample_rate
                # Mimics voice-like modulation with fundamental 220Hz + vibrato and harmonic sub-tones
                vibrato = math.sin(2 * math.pi * 6.0 * t) * 8.0
                freq = 180.0 + vibrato
                # Formant resonances simulation
                value = int(14000.0 * (
                    math.sin(2 * math.pi * freq * t) + 
                    0.4 * math.sin(2 * math.pi * (freq * 2.0) * t) +
                    0.25 * math.sin(2 * math.pi * 90.0 * t)
                ))
                data = struct.pack('<h', value)
                wav_file.writeframesraw(data)
        
        logger.info(f"Programmatic mock WAV file created at: {filepath}")

cartesia_service = CartesiaService()
