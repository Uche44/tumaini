"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/SessionContext";
import {
  uploadVoice,
  fetchSavedVoices,
  SavedVoice,
  reuseVoice,
  deleteVoice,
} from "@/lib/api";

type RecordingState =
  | "idle"
  | "requesting"
  | "recording"
  | "review"
  | "error"
  | "cloned_preview";

const MAX_DURATION_SECONDS = 120;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

// A voice is a single clone (kept unique by voice_id). Reusing a voice creates
// extra session rows pointing at the same voice_id; collapse them client-side too.
function dedupeVoices(voices: SavedVoice[]): SavedVoice[] {
  const seen = new Map<string, SavedVoice>();
  for (const v of voices) {
    if (!seen.has(v.voice_id)) {
      seen.set(v.voice_id, v);
    }
  }
  return Array.from(seen.values());
}

// ── Waveform bars (animated when playing/recording) ──────────────
function WaveformDisplay({ active }: { active: boolean }) {
  const heights = [6, 14, 22, 10, 28, 18, 8, 24, 12, 20, 16, 6, 26, 10, 18];
  return (
    <div
      className="waveform-display"
      aria-hidden="true"
    >
      {heights.map((h, i) => (
        <div
          key={i}
          className={`wave-bar${active ? " wave-bar--active" : ""}`}
          style={{
            height: active ? undefined : `${h}px`,
            animationDelay: active ? `${i * 0.04}s` : undefined,
          }}
        />
      ))}
    </div>
  );
}

export default function VoicePage() {
  const router = useRouter();
  const {
    setVoiceBlob,
    setVoiceUrl,
    voiceUrl,
    sessionId,
    voiceBlob,
    setVoiceId,
    setSessionId,
  } = useSession();

  const [state, setState] = useState<RecordingState>("idle");
  const [isUploading, setIsUploading] = useState(false);
  const [sampleAudioUrl, setSampleAudioUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [savedVoices, setSavedVoices] = useState<SavedVoice[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Load saved voices on mount
  useEffect(() => {
    fetchSavedVoices()
      .then((res) => {
        if (res.status === "success" && res.voices) {
          setSavedVoices(dedupeVoices(res.voices));
        }
      })
      .catch((err) => console.error("Failed to load saved voices:", err));
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // ── Bind audio events ────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    const targetUrl = state === "cloned_preview" ? sampleAudioUrl : voiceUrl;
    if (!audio || !targetUrl) return;

    audio.src = targetUrl;

    const onLoaded = () => setAudioDuration(audio.duration);
    const onTime = () => setCurrentTime(audio.currentTime);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, [voiceUrl, sampleAudioUrl, state]);

  // ── Start Recording ──────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setErrorMessage("");
    setState("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setVoiceBlob(blob);
        setVoiceUrl(url);
        setState("review");
        setIsPlaying(false);
        setCurrentTime(0);
      };

      recorder.start(200);
      setState("recording");
      setElapsedSeconds(0);

      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => {
          if (prev >= MAX_DURATION_SECONDS) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      console.error("Microphone error:", err);
      setState("error");
      setErrorMessage(
        "We couldn't access your microphone. Please check your browser permissions and try again.",
      );
    }
  }, [setVoiceBlob, setVoiceUrl]);

  // ── Stop Recording ───────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // ── Select previously recorded voice ──────────────────────────
  const handleSelectSavedVoice = async (selectedSessionId: string) => {
    if (!selectedSessionId) {
      setSelectedVoiceId("");
      setState("idle");
      return;
    }
    const voice = savedVoices.find((v) => v.session_id === selectedSessionId);
    if (voice) {
      try {
        // Register the reuse of the saved voice's voice_id under the CURRENT sessionId
        await reuseVoice(voice.voice_id, sessionId);

        setSelectedVoiceId(voice.voice_id);
        // set sample audio url to preview greeting
        const backendUrl =
          process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8001";
        const cleanBackend = backendUrl.endsWith("/")
          ? backendUrl.slice(0, -1)
          : backendUrl;
        const cleanUrl = voice.audio_url.startsWith("/")
          ? voice.audio_url
          : `/${voice.audio_url}`;
        const absoluteUrl = `${cleanBackend}${cleanUrl}`;

        setSampleAudioUrl(absoluteUrl);
        // update context immediately
        setVoiceId(voice.voice_id);
        setVoiceUrl(absoluteUrl);
        setState("cloned_preview");
        setIsPlaying(false);
        setCurrentTime(0);
        setErrorMessage("");
      } catch (err: any) {
        console.error("Failed to reuse voice:", err);
        setErrorMessage(
          "Could not register the selected voice for this session. Please try again.",
        );
        setState("error");
      }
    }
  };

  // ── Delete a saved voice ──────────────────────────────────────
  const handleDeleteVoice = async (voice: SavedVoice) => {
    if (!window.confirm("Delete this saved voice? It will be removed from your list.")) {
      return;
    }
    try {
      await deleteVoice(voice.voice_id);
      setSavedVoices((prev) =>
        prev.filter((v) => v.voice_id !== voice.voice_id),
      );
      if (selectedVoiceId === voice.voice_id) {
        setSelectedVoiceId("");
        setSampleAudioUrl(null);
        setVoiceId("");
        setVoiceUrl(null);
        setState("idle");
      }
    } catch (err: any) {
      console.error("Failed to delete voice:", err);
      setErrorMessage(err.message || "Failed to delete the voice. Please try again.");
    }
  };

  // ── Mic button press ─────────────────────────────────────────
  const handleMicPress = () => {
    if (state === "idle" || state === "error") {
      startRecording();
    } else if (state === "recording") {
      stopRecording();
    }
  };

  // ── Discard & Re-record ──────────────────────────────────────
  const handleDiscard = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setVoiceBlob(null);
    setVoiceUrl(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(0);
    setElapsedSeconds(0);
    setState("idle");
  };

  // ── Playback controls ────────────────────────────────────────
  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play();
      setIsPlaying(true);
    }
  };

  const handleReplay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play();
    setIsPlaying(true);
  };

  const handleDeleteRecording = () => {
    handleDiscard();
  };

  // ── File Upload ──────────────────────────────────────────────
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("audio/")) {
      setErrorMessage("Please upload an audio file (MP3, WAV, M4A, etc.)");
      setState("error");
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      setErrorMessage(
        "The audio file is too large. Please upload a file under 25MB.",
      );
      setState("error");
      return;
    }

    const url = URL.createObjectURL(file);
    setVoiceBlob(file);
    setVoiceUrl(url);
    setState("review");
    setIsPlaying(false);
    setCurrentTime(0);
  };

  // ── Navigate to next step ────────────────────────────────────
  const handleUseVoice = async () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }

    if (!voiceBlob) {
      setErrorMessage("No voice recording available to clone.");
      setState("error");
      return;
    }

    setIsUploading(true);
    setErrorMessage("");

    try {
      logger_upload("Uploading voice sample to Gradium...");
      const response = await uploadVoice(voiceBlob, sessionId);
      setVoiceId(response.voice_id);

      // Calculate absolute URL for static synthesized preview clip
      const backendUrl =
        process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8001";
      const cleanBackendUrl = backendUrl.endsWith("/")
        ? backendUrl.slice(0, -1)
        : backendUrl;
      const cleanAudioUrl = response.sample_audio_url.startsWith("/")
        ? response.sample_audio_url
        : `/${response.sample_audio_url}`;
      const fullUrl = `${cleanBackendUrl}${cleanAudioUrl}`;

      logger_upload(`Cloned successfully. Preview URL: ${fullUrl}`);
      setSampleAudioUrl(fullUrl);
      setIsUploading(false);
      setState("cloned_preview");
    } catch (err: any) {
      console.error("Gradium cloning failed:", err);
      setIsUploading(false);
      setErrorMessage(
        err.message ||
          "An error occurred while uploading your voice sample to Gradium.",
      );
      setState("error");
    }
  };

  // Log upload step (internal helper to avoid console cluttering)
  const logger_upload = (msg: string) => {
    console.log(`[Tumaini Voice] ${msg}`);
  };

  // ── hidden audio element ─────────────────────────────────────
  const audioElement = (
    <audio
      ref={audioRef}
      style={{ display: "none" }}
      aria-hidden="true"
    />
  );

  if (isUploading) {
    return (
      <div
        className="animate-fade-in"
        style={{
          minHeight: "100vh",
          background: "var(--accent-blush-gradient)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <div
          className="mic-circle-wrapper"
          style={{ cursor: "default" }}
        >
          <div className="mic-pulse-ring mic-pulse-ring--active" />
          <div className="mic-pulse-ring mic-pulse-ring--active" />
          <div className="mic-circle-btn mic-circle-btn--recording">
            <svg
              className="mic-icon animate-pulse"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line
                x1="12"
                y1="19"
                x2="12"
                y2="23"
              />
              <line
                x1="8"
                y1="23"
                x2="16"
                y2="23"
              />
            </svg>
          </div>
        </div>
        <h1
          className="voice-headline"
          style={{
            fontSize: "1.8rem",
            marginTop: "1.5rem",
            marginBottom: "0.75rem",
          }}
        >
          Mapping your voice...
        </h1>
        <p
          style={{
            color: "var(--text-muted)",
            fontFamily: "var(--font-body)",
            fontSize: "0.95rem",
            maxWidth: "300px",
            lineHeight: "1.6",
          }}
        >
          Cloning your voice. Please wait a moment while we capture your unique
          tone.
        </p>
      </div>
    );
  }

  if (state === "cloned_preview") {
    return (
      <div className="review-page animate-fade-in">
        {audioElement}

        <nav className="nav-bar nav-bar--flow">
          <button
            className="nav-icon-btn"
            onClick={handleDiscard}
            aria-label="Discard and record again"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line
                x1="18"
                y1="6"
                x2="6"
                y2="18"
              />
              <line
                x1="6"
                y1="6"
                x2="18"
                y2="18"
              />
            </svg>
          </button>
          <span className="brand-wordmark">tumaini</span>
          <span className="nav-step-counter">01 / 04</span>
        </nav>

        <div className="review-content">
          <p className="review-step-label">Step 01</p>

          <h1 className="review-headline animate-fade-up">
            Your voice,
            <br />
            cloned.
          </h1>

          <p className="review-subtext animate-fade-up delay-200">
            We&apos;ve successfully created your future self&apos;s voice
            profile. Listen to a preview below.
          </p>

          <div className="playback-card animate-fade-up delay-300">
            <div className="playback-time">
              {formatTime(currentTime)}{" "}
              <span>/ {formatTime(audioDuration || 3.5)}</span>
            </div>

            <WaveformDisplay active={isPlaying} />

            <div className="playback-controls">
              {/* Delete / Discard */}
              <button
                className="ctrl-btn"
                onClick={handleDiscard}
                aria-label="Discard and record again"
                title="Discard clone"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              </button>

              {/* Play / Pause */}
              <button
                className="ctrl-btn ctrl-btn--play"
                onClick={handlePlayPause}
                aria-label={
                  isPlaying ? "Pause playback" : "Play greeting preview"
                }
              >
                {isPlaying ? (
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <rect
                      x="6"
                      y="4"
                      width="4"
                      height="16"
                      rx="1"
                    />
                    <rect
                      x="14"
                      y="4"
                      width="4"
                      height="16"
                      rx="1"
                    />
                  </svg>
                ) : (
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                )}
              </button>

              {/* Replay */}
              <button
                className="ctrl-btn"
                onClick={handleReplay}
                aria-label="Replay from beginning"
                title="Replay preview"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M1 4v6h6" />
                  <path d="M3.51 15a9 9 0 1 0 .49-3.5" />
                </svg>
              </button>
            </div>
          </div>

          <div className="review-actions animate-fade-up delay-400">
            <button
              className="btn-primary"
              onClick={() => router.push("/story")}
              aria-label="Continue to Story step"
              style={{ width: "100%", maxWidth: "380px" }}
            >
              Continue to Story &rarr;
            </button>

            <button
              className="btn-ghost"
              onClick={handleDiscard}
              aria-label="Record again"
            >
              Record again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════
  // REVIEW STATE — matches home2.png
  // ═════════════════════════════════════════════════════════════
  if (state === "review") {
    return (
      <div className="review-page animate-fade-in">
        {audioElement}

        <nav className="nav-bar nav-bar--flow">
          <button
            className="nav-icon-btn"
            onClick={handleDiscard}
            aria-label="Go back to recording"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line
                x1="18"
                y1="6"
                x2="6"
                y2="18"
              />
              <line
                x1="6"
                y1="6"
                x2="18"
                y2="18"
              />
            </svg>
          </button>
          <span className="brand-wordmark">tumaini</span>
          <span className="nav-step-counter">01 / 04</span>
        </nav>

        <div className="review-content">
          <p className="review-step-label">Step 01</p>

          <h1 className="review-headline animate-fade-up">
            Your voice,
            <br />
            captured.
          </h1>

          <p className="review-subtext animate-fade-up delay-200">
            A moment in time preserved. Listen back before continuing.
          </p>

          <div className="playback-card animate-fade-up delay-300">
            <div className="playback-time">
              {formatTime(currentTime)}{" "}
              <span>/ {formatTime(audioDuration || elapsedSeconds)}</span>
            </div>

            <WaveformDisplay active={isPlaying} />

            <div className="playback-controls">
              {/* Delete */}
              <button
                className="ctrl-btn"
                onClick={handleDeleteRecording}
                aria-label="Delete recording and record again"
                title="Delete recording"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              </button>

              {/* Play / Pause */}
              <button
                className="ctrl-btn ctrl-btn--play"
                onClick={handlePlayPause}
                aria-label={isPlaying ? "Pause playback" : "Play recording"}
              >
                {isPlaying ? (
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <rect
                      x="6"
                      y="4"
                      width="4"
                      height="16"
                      rx="1"
                    />
                    <rect
                      x="14"
                      y="4"
                      width="4"
                      height="16"
                      rx="1"
                    />
                  </svg>
                ) : (
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                )}
              </button>

              {/* Replay */}
              <button
                className="ctrl-btn"
                onClick={handleReplay}
                aria-label="Replay from beginning"
                title="Replay"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M1 4v6h6" />
                  <path d="M3.51 15a9 9 0 1 0 .49-3.5" />
                </svg>
              </button>
            </div>
          </div>

          <div className="review-actions animate-fade-up delay-400">
            <button
              className="btn-primary"
              onClick={handleUseVoice}
              aria-label="Use this voice recording and continue"
              style={{ width: "100%", maxWidth: "380px" }}
            >
              Use this voice &rarr;
            </button>

            <button
              className="btn-ghost"
              onClick={handleDiscard}
              aria-label="Discard and record again"
            >
              Discard &amp; record again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════
  // RECORDING STATE — matches home1.png
  // ═════════════════════════════════════════════════════════════
  return (
    <div className="voice-page animate-fade-in">
      {audioElement}

      <nav className="nav-bar nav-bar--flow">
        <button
          className="nav-icon-btn"
          onClick={() => router.push("/")}
          aria-label="Go back to home"
        >
          {/* <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg> */}
        </button>
        <span className="brand-wordmark">tumaini</span>
        <span className="nav-step-counter">01 / 04</span>
      </nav>

      <div className="voice-content">
        <h1 className="voice-headline animate-fade-up">
          Let&apos;s give your future self a voice.
        </h1>

        <p className="voice-subtext animate-fade-up delay-200">
          Your future self should sound like you — just a little further down
          the road.
        </p>

        {/* Error message */}
        {state === "error" && errorMessage && (
          <div
            className="error-banner animate-fade-in"
            role="alert"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ flexShrink: 0, marginTop: "1px" }}
            >
              <circle
                cx="12"
                cy="12"
                r="10"
              />
              <line
                x1="12"
                y1="8"
                x2="12"
                y2="12"
              />
              <line
                x1="12"
                y1="16"
                x2="12.01"
                y2="16"
              />
            </svg>
            {errorMessage}
          </div>
        )}

        {/* Mic button */}
        <div
          className="mic-circle-wrapper animate-fade-up delay-300"
          onClick={handleMicPress}
          role="button"
          tabIndex={0}
          aria-label={
            state === "recording"
              ? "Stop recording"
              : "Start recording your voice"
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleMicPress();
          }}
        >
          {/* Pulse rings */}
          <div
            className={`mic-pulse-ring${state === "recording" ? " mic-pulse-ring--active" : ""}`}
          />
          <div
            className={`mic-pulse-ring${state === "recording" ? " mic-pulse-ring--active" : ""}`}
          />

          <div
            className={`mic-circle-btn${state === "recording" ? " mic-circle-btn--recording" : ""}`}
          >
            {state === "recording" ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.3rem",
                }}
              >
                <span className="recording-dot" />
                <span className="recording-timer">
                  {formatTime(elapsedSeconds)}
                </span>
              </div>
            ) : state === "requesting" ? (
              <svg
                className="mic-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ opacity: 0.5 }}
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line
                  x1="12"
                  y1="19"
                  x2="12"
                  y2="23"
                />
                <line
                  x1="8"
                  y1="23"
                  x2="16"
                  y2="23"
                />
              </svg>
            ) : (
              <svg
                className="mic-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line
                  x1="12"
                  y1="19"
                  x2="12"
                  y2="23"
                />
                <line
                  x1="8"
                  y1="23"
                  x2="16"
                  y2="23"
                />
              </svg>
            )}
          </div>
        </div>

        {/* State-based label */}
        {state === "recording" ? (
          <>
            <p
              className="voice-tap-label animate-fade-in"
              style={{ color: "var(--brand-deep-plum)" }}
            >
              Recording... tap to stop
            </p>
            <p className="voice-tap-hint animate-fade-in">
              {MAX_DURATION_SECONDS - elapsedSeconds}s remaining
            </p>
          </>
        ) : (
          <>
            <p className="voice-tap-label animate-fade-up delay-400">
              Tap to record
            </p>
            <p className="voice-tap-hint animate-fade-up delay-500">
              Speak naturally for 10–30 seconds.
            </p>
          </>
        )}

        {/* Saved voices list */}
        {state !== "recording" && savedVoices.length > 0 && (
          <div
            ref={dropdownRef}
            className="animate-fade-up delay-600 custom-select-container"
            style={{
              marginTop: "1.5rem",
              marginBottom: "1rem",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.85rem",
                color: "var(--text-muted)",
                marginBottom: "0.5rem",
                display: "block",
              }}
            >
              Or reuse a previously recorded voice:
            </span>

            <button
              type="button"
              className={`custom-select-trigger ${
                dropdownOpen ? "custom-select-trigger--open" : ""
              }`}
              onClick={() => setDropdownOpen(!dropdownOpen)}
              aria-expanded={dropdownOpen}
              aria-haspopup="listbox"
            >
              <div className="custom-select-trigger-text">
                <span className="custom-select-trigger-label">
                  {selectedVoiceId ? "Selected Profile" : "Available Voices"}
                </span>
                <span className="custom-select-trigger-value">
                  {selectedVoiceId
                    ? (() => {
                        const matched = savedVoices.find(
                          (v) => v.voice_id === selectedVoiceId,
                        );
                        if (matched?.created_at) {
                          return new Date(matched.created_at).toLocaleDateString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          );
                        }
                        return `Saved Voice (${selectedVoiceId.slice(0, 8)}...)`;
                      })()
                    : "Choose a saved voice"}
                </span>
              </div>
              <svg
                className="custom-select-arrow"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div
              className={`custom-select-dropdown ${
                dropdownOpen ? "custom-select-dropdown--open" : ""
              }`}
              role="listbox"
            >
              {savedVoices.map((v, i) => {
                const dateLabel = v.created_at
                  ? new Date(v.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : `Saved Voice #${i + 1}`;
                const isSelected = selectedVoiceId === v.voice_id;

                return (
                  <div
                    key={v.voice_id}
                    role="option"
                    aria-selected={isSelected}
                    className={`custom-select-option ${
                      isSelected ? "custom-select-option--selected" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="custom-select-option-main"
                      aria-label={`Use voice from ${dateLabel}`}
                      onClick={() => {
                        handleSelectSavedVoice(v.session_id);
                        setDropdownOpen(false);
                      }}
                    >
                      <span className="custom-select-option-title">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ opacity: isSelected ? 1 : 0.4 }}
                        >
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        </svg>
                        {dateLabel}
                      </span>
                      <span className="custom-select-option-subtitle">
                        ID: {v.voice_id.slice(0, 16)}...
                      </span>
                    </button>
                    <button
                      type="button"
                      className="custom-select-option-delete"
                      aria-label={`Delete voice from ${dateLabel}`}
                      title="Delete voice"
                      onClick={() => handleDeleteVoice(v)}
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4h6v2" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* File upload fallback */}
        {state !== "recording" && (
          <>
            <button
              className="voice-upload-link animate-fade-up delay-600"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Upload an existing voice recording"
              style={{ marginTop: "0.5rem" }}
            >
              or upload a new voice recording
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              style={{ display: "none" }}
              onChange={handleFileUpload}
              aria-label="Upload audio file"
            />
          </>
        )}

        <p className="voice-privacy-note animate-fade-up delay-700">
          Your voice is only used to create your Future Self experience.
        </p>
      </div>
    </div>
  );
}
