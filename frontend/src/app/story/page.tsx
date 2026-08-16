'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/context/SessionContext';
import { saveUserStory } from '@/lib/api';

const PREDEFINED_TRAITS = [
  "Resilient", 
  "Empathetic", 
  "Creative", 
  "Determined", 
  "Optimistic", 
  "Patient", 
  "Anxious", 
  "Hopeful", 
  "Tired", 
  "Inspired", 
  "Overwhelmed", 
  "Reflective", 
  "Seeking"
];

export default function StoryPage() {
  const router = useRouter();
  const { sessionId } = useSession();

  // ── Form States ──────────────────────────────────────────────
  const [situation, setSituation] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [goalInput, setGoalInput] = useState('');
  const [challenges, setChallenges] = useState('');
  const [selectedTraits, setSelectedTraits] = useState<string[]>([]);
  const [customTraitInput, setCustomTraitInput] = useState('');
  const [reminders, setReminders] = useState('');
  const [memory, setMemory] = useState('');
  const [forWhom, setForWhom] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Goal Handlers ────────────────────────────────────────────
  const handleAddGoal = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanGoal = goalInput.trim();
    if (cleanGoal && !goals.includes(cleanGoal)) {
      setGoals([...goals, cleanGoal]);
      setGoalInput('');
    }
  };

  const handleRemoveGoal = (index: number) => {
    setGoals(goals.filter((_, i) => i !== index));
  };

  // ── Trait Handlers ───────────────────────────────────────────
  const handleToggleTrait = (trait: string) => {
    if (selectedTraits.includes(trait)) {
      setSelectedTraits(selectedTraits.filter((t) => t !== trait));
    } else {
      setSelectedTraits([...selectedTraits, trait]);
    }
  };

  const handleAddCustomTrait = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTrait = customTraitInput.trim();
    if (cleanTrait) {
      // Capitalize first letter
      const capitalized = cleanTrait.charAt(0).toUpperCase() + cleanTrait.slice(1);
      if (!selectedTraits.includes(capitalized)) {
        setSelectedTraits([...selectedTraits, capitalized]);
      }
      setCustomTraitInput('');
    }
  };

  // ── Submit Handler ───────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validation checks
    if (!situation.trim()) {
      setErrorMessage("Please tell us where you are right now.");
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (goals.length === 0) {
      setErrorMessage("Please add at least one goal or aspiration you are working toward.");
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!challenges.trim()) {
      setErrorMessage("Please share what is making it difficult right now.");
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (selectedTraits.length === 0) {
      setErrorMessage("Please select or add at least one trait describing how you are right now.");
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setIsSubmitting(true);

    try {
      await saveUserStory({
        situation: situation.trim(),
        goals,
        challenges: challenges.trim(),
        traits: selectedTraits,
        reminders: reminders.trim() || undefined,
        memory: memory.trim() || undefined,
        forWhom: forWhom.trim() || undefined
      }, sessionId);

      // Successfully saved, push to generating transition loader
      router.push('/generating');
    } catch (err: any) {
      console.error("Failed to save story:", err);
      setErrorMessage(err.message || "An unexpected error occurred while saving. Please try again.");
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-warm-ivory)' }}>
      {/* Navigation */}
      <nav className="nav-bar nav-bar--flow">
        <button 
          className="nav-icon-btn" 
          onClick={() => router.push('/voice')} 
          aria-label="Go back to voice cloning"
          disabled={isSubmitting}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="brand-wordmark">tumaini</span>
        <span className="nav-step-counter">02 / 04</span>
      </nav>

      <div className="reflection-wrapper animate-fade-in">
        {/* Header intro */}
        <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
          <h1 
            style={{ 
              fontFamily: 'var(--font-heading)', 
              fontSize: 'clamp(2.2rem, 5.5vw, 3rem)', 
              color: 'var(--text-charcoal)', 
              marginBottom: '1rem' 
            }}
          >
            Write your <em style={{ color: 'var(--brand-deep-plum)' }}>story.</em>
          </h1>
          <p 
            style={{ 
              fontFamily: 'var(--font-body)', 
              color: 'var(--text-muted)', 
              maxWidth: '480px', 
              margin: '0 auto', 
              lineHeight: '1.7',
              fontSize: '0.98rem'
            }}
          >
            This is a quiet space to reflect. Share what you are going through, your aspirations, and what stands in your path. Only your future self will hear this.
          </p>
        </div>

        {/* Validation Error Banner */}
        {errorMessage && (
          <div className="error-banner animate-fade-in">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: '2px' }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Card 1: Current Situation */}
          <div className="reflection-card">
            <h2 className="reflection-title">Where are you right now?</h2>
            <p className="reflection-subtext">
              Describe your current life situation, daily routine, or how you feel emotionally.
            </p>
            <textarea
              className="reflection-textarea"
              rows={4}
              value={situation}
              onChange={(e) => setSituation(e.target.value)}
              placeholder="Right now, I am experiencing..."
              disabled={isSubmitting}
            />
          </div>

          {/* Card 2: Goals & Aspirations */}
          <div className="reflection-card">
            <h2 className="reflection-title">What are you working toward?</h2>
            <p className="reflection-subtext">
              Add the core aspirations, dreams, or milestones you want to achieve.
            </p>
            
            {/* Added Goals List */}
            {goals.length > 0 && (
              <div className="goals-list">
                {goals.map((goal, idx) => (
                  <div key={idx} className="goal-tag">
                    <span>{goal}</span>
                    <button
                      type="button"
                      className="goal-delete-btn"
                      onClick={() => handleRemoveGoal(idx)}
                      aria-label={`Remove goal: ${goal}`}
                      disabled={isSubmitting}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Goal Input Row */}
            <div className="goal-input-row">
              <input
                type="text"
                className="goal-input-field"
                placeholder="Type an aspiration here..."
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddGoal();
                  }
                }}
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="btn-primary"
                style={{ padding: '0.75rem 1.5rem', borderRadius: '0.75rem', width: 'auto' }}
                onClick={() => handleAddGoal()}
                disabled={isSubmitting}
              >
                Add
              </button>
            </div>
          </div>

          {/* Card 3: Present Challenges */}
          <div className="reflection-card">
            <h2 className="reflection-title">What is making it difficult right now?</h2>
            <p className="reflection-subtext">
              What are the primary obstacles, fears, or challenges you are currently facing?
            </p>
            <textarea
              className="reflection-textarea"
              rows={4}
              value={challenges}
              onChange={(e) => setChallenges(e.target.value)}
              placeholder="The hardest part is..."
              disabled={isSubmitting}
            />
          </div>

          {/* Card 4: Personality Traits */}
          <div className="reflection-card">
            <h2 className="reflection-title">What are you like?</h2>
            <p className="reflection-subtext">
              Select or add the qualities and feelings that best describe you right now (select at least one).
            </p>

            {/* Chips Grid */}
            <div className="trait-chips-container">
              {PREDEFINED_TRAITS.map((trait) => {
                const isSelected = selectedTraits.includes(trait);
                return (
                  <button
                    key={trait}
                    type="button"
                    className={`trait-pill${isSelected ? ' trait-pill--selected' : ''}`}
                    onClick={() => handleToggleTrait(trait)}
                    disabled={isSubmitting}
                  >
                    {trait}
                  </button>
                );
              })}
              {/* Display user custom added traits as selected chips if they aren't in predefined list */}
              {selectedTraits
                .filter((t) => !PREDEFINED_TRAITS.includes(t))
                .map((trait) => (
                  <button
                    key={trait}
                    type="button"
                    className="trait-pill trait-pill--selected"
                    onClick={() => handleToggleTrait(trait)}
                    disabled={isSubmitting}
                  >
                    {trait}
                  </button>
                ))
              }
            </div>

            {/* Custom Trait Input */}
            <div className="trait-custom-row">
              <input
                type="text"
                className="goal-input-field"
                placeholder="Add custom trait..."
                value={customTraitInput}
                onChange={(e) => setCustomTraitInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddCustomTrait(e);
                  }
                }}
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="btn-primary"
                style={{ padding: '0.75rem 1.5rem', borderRadius: '0.75rem', width: 'auto' }}
                onClick={(e) => handleAddCustomTrait(e)}
                disabled={isSubmitting}
              >
                Add
              </button>
            </div>
          </div>

          {/* Card 5: Optional Reminders */}
          <div className="reflection-card">
            <h2 className="reflection-title">What do you want to be reminded of? <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>(Optional)</span></h2>
            <p className="reflection-subtext">
              Is there a promise to yourself, or a reason you started, that you want your future self to voice back to you?
            </p>
            <textarea
              className="reflection-textarea"
              rows={3}
              value={reminders}
              onChange={(e) => setReminders(e.target.value)}
              placeholder="Remind me to..."
              disabled={isSubmitting}
            />
          </div>

          {/* Card 6: Optional Memory */}
          <div className="reflection-card">
            <h2 className="reflection-title">Is there a memory your future self should carry? <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>(Optional)</span></h2>
            <p className="reflection-subtext">
              A moment, a person, a feeling — something worth keeping safe all the way there.
            </p>
            <textarea
              className="reflection-textarea"
              rows={3}
              value={memory}
              onChange={(e) => setMemory(e.target.value)}
              placeholder="The memory I want to keep is..."
              disabled={isSubmitting}
            />
          </div>

          {/* Card 7: Optional Reason */}
          <div className="reflection-card">
            <h2 className="reflection-title">Who are you doing this for? <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>(Optional)</span></h2>
            <p className="reflection-subtext">
              A name, a face, a reason — the person underneath everything you're reaching for.
            </p>
            <textarea
              className="reflection-textarea"
              rows={3}
              value={forWhom}
              onChange={(e) => setForWhom(e.target.value)}
              placeholder="I'm doing this for..."
              disabled={isSubmitting}
            />
          </div>

          {/* Actions */}
          <div style={{ textAlign: 'center', marginTop: '4rem' }}>
            <button
              type="submit"
              className="btn-primary"
              style={{ width: '100%', maxWidth: '420px', fontSize: '1.05rem', padding: '1.1rem 2rem' }}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Creating your Future Self..." : "Create Future Self →"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
