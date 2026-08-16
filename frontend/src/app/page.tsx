"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const CYCLING_WORDS = [
  "stuck.",
  "lost.",
  "exhausted.",
  "uncertain.",
  "tired.",
  "afraid.",
];

const MARQUEE_ITEMS = [
  "hear hope from your future self",
  "a voice from tomorrow",
  "you made it through",
  "the person you're becoming",
  "already waiting for you",
  "hear hope from your future self",
  "a voice from tomorrow",
  "you made it through",
  "the person you're becoming",
  "already waiting for you",
];

export default function WelcomePage() {
  const router = useRouter();
  const [wordIndex, setWordIndex] = useState(0);
  const [wordVisible, setWordVisible] = useState(true);
  const revealRefs = useRef<(HTMLElement | null)[]>([]);

  // Word cycling animation
  useEffect(() => {
    const interval = setInterval(() => {
      setWordVisible(false);
      setTimeout(() => {
        setWordIndex((i) => (i + 1) % CYCLING_WORDS.length);
        setWordVisible(true);
      }, 400);
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  // Scroll reveal via IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );

    revealRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const addRef = (el: HTMLElement | null, index: number) => {
    revealRefs.current[index] = el;
  };

  return (
    <main>
      {/* ── Minimal Nav ── */}
      <nav className="nav-bar">
        <div style={{ width: 36 }} />
        <span className="brand-wordmark">tumaini</span>
        <div style={{ width: 36 }} />
      </nav>

      {/* ── Hero Section ── */}
      <section className="hero-section">
        <p className="hero-eyebrow">An AI-powered Future Self experience</p>

        <h1 className="hero-headline">
          Sometimes you feel{" "}
          <span
            style={{
              display: "inline-block",
              fontStyle: "italic",
              color: "var(--brand-deep-plum)",
              opacity: wordVisible ? 1 : 0,
              transform: wordVisible ? "translateY(0)" : "translateY(-6px)",
              transition: "opacity 0.35s ease, transform 0.35s ease",
            }}
          >
            {CYCLING_WORDS[wordIndex]}
          </span>
          <br />
          What if you could hear from the version
          <br />
          of you who already <em>made it through?</em>
        </h1>

        <p className="hero-subtext">
          Tumaini means <em>hope</em> in Swahili. It gives your future self a
          voice — so the you of tomorrow can reach back and remind the you of
          today why it&apos;s still worth going.
        </p>

        <Link
          href="/voice"
          className="btn-primary animate-fade-up delay-800"
          aria-label="Begin the Tumaini experience"
          style={{ textDecoration: "none" }}
        >
          Begin &rarr;
        </Link>

        <p
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            marginTop: "1rem",
            opacity: 0,
            animation: "fadeIn 0.6s ease-out 1.1s forwards",
          }}
        >
          No account needed &nbsp;&bull;&nbsp; Takes about 5 minutes
        </p>
      </section>

      {/* ── Marquee Band ── */}
      <div
        className="marquee-band"
        aria-hidden="true"
      >
        <div className="marquee-track">
          {MARQUEE_ITEMS.map((item, i) => (
            <span
              key={i}
              className="marquee-item"
            >
              {item}
              {i < MARQUEE_ITEMS.length - 1 && (
                <span className="marquee-dot"> &bull; </span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* ── Story Section ── */}
      <section className="section-story">
        <div className="container">
          <article
            className="story-block reveal"
            ref={(el) => addRef(el as HTMLElement | null, 0)}
          >
            <span className="story-number">01 of 03</span>
            <h2 className="story-headline">
              Your future self has already
              <br />
              <em>made it through.</em>
            </h2>
            <p className="story-body">
              They know what you&apos;re going through right now — because they
              lived it. They remember the doubt, the fear, the moments you
              thought you couldn&apos;t keep going.
            </p>
          </article>

          <article
            className="story-block reveal"
            ref={(el) => addRef(el as HTMLElement | null, 1)}
          >
            <span className="story-number">02 of 03</span>
            <h2 className="story-headline">
              Tumaini gives them <em>a voice.</em>
            </h2>
            <p className="story-body">
              You tell us where you are. Your goals. What&apos;s making it hard.
              And we create a personalized message from a future version of you
              — shaped by your own story, spoken in your own voice.
            </p>
          </article>

          <article
            className="story-block reveal"
            ref={(el) => addRef(el as HTMLElement | null, 2)}
          >
            <span className="story-number">03 of 03</span>
            <h2 className="story-headline">
              A message. From you,
              <br />
              <em>to you.</em>
            </h2>
            <p className="story-body">
              Not generic advice. Not a stranger&apos;s platitudes. A deeply
              personal voice note — from the person you are becoming — arriving
              exactly when you need it most.
            </p>
          </article>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="section-how">
        <div className="container-wide">
          <p className="section-how__label">How it works</p>
          <div className="steps-grid">
            {[
              {
                num: "Step 01",
                title: "Give your voice",
                desc: "Record a short clip. Your future self will speak through it.",
              },
              {
                num: "Step 02",
                title: "Share your story",
                desc: "Tell us where you are, your goals, and what's weighing on you.",
              },
              {
                num: "Step 03",
                title: "We create your Future Self",
                desc: "Our AI builds a believable, aspirational version of you based on everything you shared.",
              },
              {
                num: "Step 04",
                title: "Listen",
                desc: "Receive a personalized audio message from the you who made it.",
              },
            ].map((step, i) => (
              <div
                key={i}
                className="step-card reveal"
                ref={(el) => addRef(el as HTMLElement | null, 3 + i)}
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                <span className="step-card__number">{step.num}</span>
                <h3 className="step-card__title">{step.title}</h3>
                <p className="step-card__desc">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Emotional Quote ── */}
      <section
        className="section-quote reveal"
        ref={(el) => addRef(el as HTMLElement | null, 7)}
      >
        <div className="container">
          <blockquote className="quote-text">
            &ldquo;I remember this version of us. Losing that job made you
            question whether you were actually good enough. You weren&apos;t
            seeing it then, but that wasn&apos;t the end of our career. It was
            the point where we started building something of our
            own&hellip;&rdquo;
          </blockquote>
          <p className="quote-attribution">— A message from your future self</p>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section
        className="section-cta reveal"
        ref={(el) => addRef(el as HTMLElement | null, 8)}
      >
        <div className="container">
          <h2 className="cta-headline">
            Ready to hear from
            <br />
            <em style={{ color: "var(--brand-deep-plum)" }}>
              your future self?
            </em>
          </h2>
          <p className="cta-subtext">
            It only takes a few minutes. Your story stays with you.
          </p>

          <Link
            href="/voice"
            className="btn-primary"
            aria-label="Begin the Tumaini experience"
            style={{ textDecoration: "none" }}
          >
            Begin &rarr;
          </Link>

          <div
            className="step-dots"
            style={{ marginTop: "2.5rem" }}
          >
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="step-dot"
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="footer-minimal">
        <p>
          <em>tumaini</em> &mdash; Swahili for <em>hope</em>
        </p>
        <p style={{ marginTop: "0.4rem" }}>
          Your story and voice are private to you.
        </p>
      </footer>
    </main>
  );
}
