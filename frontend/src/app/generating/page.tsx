'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/context/SessionContext';
import { generatePersona, generateScript, generateAudio } from '@/lib/api';

type StepState = 'loading' | 'ready' | 'playing';
type CheckpointStatus = 'pending' | 'active' | 'completed' | 'failed';

interface Checkpoints {
  persona: CheckpointStatus;
  script: CheckpointStatus;
  audio: CheckpointStatus;
}

export default function GeneratingPage() {
  const router = useRouter();
  const { sessionId, traits } = useSession();

  // ── States ───────────────────────────────────────────────────
  const [step, setStep] = useState<StepState>('loading');
  const [checkpoints, setCheckpoints] = useState<Checkpoints>({
    persona: 'pending',
    script: 'pending',
    audio: 'pending',
  });

  const [persona, setPersona] = useState<any>(null);
  const [script, setScript] = useState<string>('');
  const [audioUrl, setAudioUrl] = useState<string>('');

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isStartedRef = useRef(false);

  // ── Helper to format time (e.g. 01:23) ────────────────────────
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ── Perform API Sequence ─────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    if (isStartedRef.current) return;
    isStartedRef.current = true;

    const runCascade = async () => {
      try {
        // Step 1: Generate Persona
        setCheckpoints((prev) => ({ ...prev, persona: 'active' }));
        const personaRes = await generatePersona(sessionId);
        setPersona(personaRes.persona);
        setCheckpoints((prev) => ({ ...prev, persona: 'completed' }));

        // Step 2: Generate Script
        setCheckpoints((prev) => ({ ...prev, script: 'active' }));
        const scriptRes = await generateScript(sessionId);
        setScript(scriptRes.script);
        setCheckpoints((prev) => ({ ...prev, script: 'completed' }));

        // Step 3: Generate Audio
        setCheckpoints((prev) => ({ ...prev, audio: 'active' }));
        const audioRes = await generateAudio(sessionId);
        
        // Build absolute URL for audio source
        const backendUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8001';
        const cleanBackend = backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl;
        const cleanUrl = audioRes.audio_url.startsWith('/') ? audioRes.audio_url : `/${audioRes.audio_url}`;
        setAudioUrl(`${cleanBackend}${cleanUrl}`);
        setCheckpoints((prev) => ({ ...prev, audio: 'completed' }));

        // Sequence complete, wait 1 second and show Ready state
        setTimeout(() => {
          setStep('ready');
        }, 1200);

      } catch (err: any) {
        console.error("Generation cascade failed:", err);
        setErrorMessage(
          err.message || 
          "We ran into a connection issue while generating your Future Self. Please try again."
        );
        // Mark active steps as failed
        setCheckpoints((prev) => {
          const updated = { ...prev };
          if (updated.persona === 'active') updated.persona = 'failed';
          if (updated.script === 'active') updated.script = 'failed';
          if (updated.audio === 'active') updated.audio = 'failed';
          return updated;
        });
      }
    };

    runCascade();
  }, [sessionId]);

  // ── Bind audio element events ───────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    audio.src = audioUrl;

    const onLoaded = () => setDuration(audio.duration);
    const onTime = () => setCurrentTime(audio.currentTime);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnded);
    };
  }, [audioUrl]);

  // ── Play / Pause ─────────────────────────────────────────────
  const handlePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(err => console.error("Audio play failed:", err));
      setIsPlaying(true);
    }
  }, [isPlaying]);

  // ── Seek via timeline click ──────────────────────────────────
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percentage = clickX / width;
    const targetTime = percentage * duration;
    audio.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  // ── Skip Back 10 seconds ──────────────────────────────────────
  const handleSkipBack = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, audio.currentTime - 10);
    setCurrentTime(audio.currentTime);
  }, []);

  // ── Skip Forward 10 seconds ───────────────────────────────────
  const handleSkipForward = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.min(duration, audio.currentTime + 10);
    setCurrentTime(audio.currentTime);
  }, [duration]);

  // ── Seek range fallback ───────────────────────────────────────
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const targetValue = parseFloat(e.target.value);
    audio.currentTime = targetValue;
    setCurrentTime(targetValue);
  };

  // ── Replay ───────────────────────────────────────────────────
  const handleReplay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
    audio.play().catch(err => console.error("Audio replay failed:", err));
    setIsPlaying(true);
  }, []);

  // ── Hear CTA click ───────────────────────────────────────────
  const handleHearCTA = () => {
    setStep('playing');
    setTimeout(() => {
      const audio = audioRef.current;
      if (audio) {
        audio.play().catch(err => console.error("Auto play failed:", err));
        setIsPlaying(true);
      }
    }, 150);
  };

  // ── Restart experience ───────────────────────────────────────
  const handleRestart = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    // Clear localStorage to reset session ID cache
    localStorage.removeItem('tumaini_session_id');
    window.location.href = '/';
  };

  // ── Waveform bars (animated when playing) ──────────────
  const WaveformDisplay = ({ active }: { active: boolean }) => {
    const heights = [10, 24, 40, 18, 56, 32, 14, 48, 22, 38, 28, 12, 52, 20, 36, 16, 44, 26, 10];
    return (
      <div 
        className="waveform-display" 
        aria-hidden="true"
        style={{ justifyContent: 'center', height: '64px', margin: '2rem 0' }}
      >
        {heights.map((h, i) => (
          <div
            key={i}
            className={`wave-bar${active ? ' wave-bar--active' : ''}`}
            style={{
              height: active ? undefined : `${h}px`,
              animationDelay: active ? `${i * 0.03}s` : undefined,
              background: active ? 'var(--brand-deep-plum)' : 'var(--border-subtle)',
              width: '4px',
              margin: '0 2.5px',
              borderRadius: '2px',
            }}
          />
        ))}
      </div>
    );
  };

  // ── Single-root render — audio element never unmounts ───────
  return (
    <main
      className="animate-fade-in"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'var(--bg-warm-ivory)',
        textAlign: 'center',
      }}
    >
      {/* Audio element stays mounted for the full lifetime of this page */}
      <audio ref={audioRef} style={{ display: 'none' }} aria-hidden="true" />

      {/* ═══════════ LOADING STATE ═══════════ */}
      {step === 'loading' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            width: '100%',
          }}
        >
          <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', letterSpacing: '0.25em', textTransform: 'uppercase', color: 'var(--accent-muted-rose)', marginBottom: '1.5rem' }}>
            03 / 04
          </span>

          <h1
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(1.8rem, 4.5vw, 2.5rem)',
              color: 'var(--text-charcoal)',
              marginBottom: '0.75rem'
            }}
          >
            We&apos;re putting the pieces together.
          </h1>
          <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-body)', fontSize: '0.92rem', maxWidth: '380px', lineHeight: '1.6' }}>
            Combining your story, your aspirations, your obstacles, and your voice into tomorrow.
          </p>

          {/* Checkpoints Checklist */}
          <div className="checkpoints-container">
            <div className={`checkpoint-item${checkpoints.persona === 'active' ? ' checkpoint-item--active' : ''}${checkpoints.persona === 'completed' ? ' checkpoint-item--completed' : ''}`}>
              <div className="checkpoint-indicator">
                {checkpoints.persona === 'completed' ? '✓' : checkpoints.persona === 'failed' ? '✕' : '1'}
              </div>
              <span>Analyzing your situation &amp; goals</span>
            </div>

            <div className={`checkpoint-item${checkpoints.script === 'active' ? ' checkpoint-item--active' : ''}${checkpoints.script === 'completed' ? ' checkpoint-item--completed' : ''}`}>
              <div className="checkpoint-indicator">
                {checkpoints.script === 'completed' ? '✓' : checkpoints.script === 'failed' ? '✕' : '2'}
              </div>
              <span>Synthesizing persona dialogue script</span>
            </div>

            <div className={`checkpoint-item${checkpoints.audio === 'active' ? ' checkpoint-item--active' : ''}${checkpoints.audio === 'completed' ? ' checkpoint-item--completed' : ''}`}>
              <div className="checkpoint-indicator">
                {checkpoints.audio === 'completed' ? '✓' : checkpoints.audio === 'failed' ? '✕' : '3'}
              </div>
              <span>Generating future self voice audio</span>
            </div>
          </div>

          {/* Error Fallback Box */}
          {errorMessage && (
            <div className="error-banner animate-fade-in" style={{ maxWidth: '420px', marginTop: '2.5rem' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: '2px' }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span>{errorMessage}</span>
                <button
                  className="btn-ghost"
                  onClick={() => window.location.reload()}
                  style={{ width: 'fit-content', padding: '0.25rem 0', color: 'inherit', textDecoration: 'underline' }}
                >
                  Retry generation
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ READY STATE ═══════════ */}
      {step === 'ready' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            width: '100%',
          }}
        >
          <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', letterSpacing: '0.25em', textTransform: 'uppercase', color: 'var(--accent-muted-rose)', marginBottom: '1.5rem' }}>
            Ready
          </span>

          {/* Ambient Pulsing Aura representing Future Self */}
          <div className="ambient-glow-wrapper">
            <div className="ambient-glow-sphere" />
            <div className="ambient-glass-ring" />
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--brand-deep-plum)" strokeWidth="1.2" strokeLinecap="round" style={{ position: 'absolute' }}>
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
              <line x1="12" y1="18" x2="12" y2="22" />
            </svg>
          </div>

          <h1
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(2rem, 5vw, 2.8rem)',
              color: 'var(--text-charcoal)',
              marginBottom: '0.75rem',
              marginTop: '1.5rem'
            }}
          >
            Your future self is here.
          </h1>
          <p
            style={{
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-body)',
              fontSize: '0.98rem',
              maxWidth: '380px',
              lineHeight: '1.7',
              marginBottom: '3rem'
            }}
          >
            They have navigated the obstacles you face today. They are ready to remind you why you started.
          </p>

          <button
            className="btn-primary animate-pulse"
            style={{ width: '100%', maxWidth: '380px', padding: '1.1rem 2rem', fontSize: '1.05rem' }}
            onClick={handleHearCTA}
          >
            Hear what they have to say
          </button>
        </div>
      )}

      {/* ═══════════ PLAYING STATE ═══════════ */}
      {step === 'playing' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '5rem 1.5rem 6rem 1.5rem',
            width: '100%',
          }}
        >
          {/* Navigation */}
          <nav className="nav-bar nav-bar--flow">
            <button
              className="nav-icon-btn"
              onClick={handleRestart}
              aria-label="Go home"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <span className="brand-wordmark">tumaini</span>
            <span className="nav-step-counter">01 / 04</span>
          </nav>

          {/* Headline */}
          <h1
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(1.8rem, 5vw, 2.5rem)',
              color: 'var(--text-charcoal)',
              marginTop: '1rem',
              marginBottom: '1rem',
              maxWidth: '600px',
              lineHeight: '1.25',
            }}
          >
            Your future self has something to say.
          </h1>

          {/* Central Circular Aura & Mockup Frame */}
          <div className="message-circle-glow-wrapper">
            <div className="message-circle-glow" />
            <div className="message-circle-frame">
              <div className="message-mock-window">
                <div className="mock-window-header">
                  <span className="dot dot-red" />
                  <span className="dot dot-yellow" />
                  <span className="dot dot-green" />
                  <span className="mock-window-title">Your Future Self</span>
                </div>
                <div className="mock-window-content">
                  <div className="mock-stat-item">
                    {traits && traits[0] ? `${traits[0]} Soul` : '240bpm Soul'}
                  </div>
                  <div className="mock-stat-item">
                    {traits && traits[1] ? `${traits[1]} Heart` : '54 Heart'}
                  </div>
                  <div className="mock-stat-item">
                    {persona?.career_path ? (persona.career_path.length > 18 ? `${persona.career_path.slice(0, 16)}...` : persona.career_path) : 'Joyful Focus'}
                  </div>
                  <div className="mock-stat-item">
                    {persona?.years_in_future ? `${persona.years_in_future} Years Forward` : 'Twelve'}
                  </div>
                </div>
              </div>
              <div className="message-circle-light-overlay" />
            </div>
          </div>

          {/* Timeline progress seeker container */}
          <div className="message-timeline-wrapper">
            {/* Time labels above the progress line */}
            <div className="message-time-labels">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration || 60)}</span>
            </div>

            {/* Clickable progress seeker line */}
            <div 
              className="message-timeline-bar-container"
              onClick={handleTimelineClick}
              role="slider"
              aria-label="Seek audio playback"
              aria-valuenow={currentTime}
              aria-valuemin={0}
              aria-valuemax={duration || 60}
            >
              <div 
                className="message-timeline-bar-progress"
                style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
              />
            </div>
          </div>

          {/* Playback Controls Row */}
          <div className="message-controls-row">
            {/* Skip Back 10s */}
            <button
              className="message-skip-btn"
              onClick={handleSkipBack}
              aria-label="Skip backward 10 seconds"
              title="-10s"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 2v6h6M2.66 15.57a10 10 0 1 0-.57-8.38l.41.81" />
                <text x="12" y="15" fontSize="7" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle" fill="currentColor">10</text>
              </svg>
            </button>

            {/* Circular Play / Pause Button */}
            <button
              className="message-play-btn"
              onClick={handlePlayPause}
              aria-label={isPlaying ? 'Pause message' : 'Play message'}
            >
              {isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '1px' }}>
                  <rect x="5" y="4" width="4" height="16" rx="1" />
                  <rect x="15" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '4px' }}>
                  <polygon points="6,3 20,12 6,21" />
                </svg>
              )}
            </button>

            {/* Skip Forward 10s */}
            <button
              className="message-skip-btn"
              onClick={handleSkipForward}
              aria-label="Skip forward 10 seconds"
              title="+10s"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1 .57-8.38l-.41.81" />
                <text x="12" y="15" fontSize="7" fontWeight="bold" fontFamily="sans-serif" textAnchor="middle" fill="currentColor">10</text>
              </svg>
            </button>
          </div>

          {/* Bottom Serif Quote */}
          <p className="message-footer-quote">
            &ldquo;You haven&apos;t met all of yourself yet.&rdquo;
          </p>

          {/* Start Over Journey link */}
          <button
            className="btn-ghost"
            onClick={handleRestart}
            style={{ marginTop: '2.5rem', fontSize: '0.9rem', color: 'var(--brand-deep-plum)', textDecoration: 'underline' }}
          >
            Start another reflection journey
          </button>
        </div>
      )}
    </main>
  );
}
