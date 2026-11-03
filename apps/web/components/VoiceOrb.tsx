"use client";

import { useEffect, useRef } from "react";

interface Props {
  live: boolean;
  /** Fills the buffer with 0–255 per frequency bin; false when no audio graph. */
  readSpectrum: (out: Uint8Array<ArrayBuffer>) => boolean;
  spectrumSize: number;
  /** Box size in px (hero 280, card 168). */
  size?: number;
  bars?: number;
  idleHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  /** Centre content: the hero's photo, a card's initials. */
  children: React.ReactNode;
}

/**
 * Radial waveform ring. Idle bars rest short in `--ring-idle`; during a call their heights follow the live
 * audio (agent playback or mic, whichever is louder) in `--accent`.
 */
export function VoiceOrb({
  live,
  readSpectrum,
  spectrumSize,
  size = 280,
  bars = 48,
  idleHeight = 10,
  minHeight = 14,
  maxHeight = 40,
  children,
}: Props) {
  const els = useRef<Array<HTMLSpanElement | null>>([]);
  const half = size / 2;

  useEffect(() => {
    if (!live) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // static live ring
    const bins = new Uint8Array(spectrumSize);
    // Scatter the useful voice bins (≈125 Hz–3 kHz) around the ring so it doesn't look top-heavy.
    const binFor = (i: number) => 1 + ((i * 7) % 24);
    let raf = 0;
    const tick = () => {
      if (readSpectrum(bins)) {
        for (let i = 0; i < bars; i++) {
          const b = binFor(i);
          // Higher bins are quieter in speech: lift them a little.
          const v = Math.min(1, (bins[b]! / 255) * (1 + b / 16));
          const el = els.current[i];
          if (el) el.style.height = `${minHeight + v * (maxHeight - minHeight)}px`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, readSpectrum, spectrumSize, bars, minHeight, maxHeight]);

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: bars }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              els.current[i] = el;
            }}
            style={{
              position: "absolute",
              left: half - 1,
              top: 0,
              width: 2,
              height: live ? (minHeight + maxHeight) / 2 : idleHeight,
              borderRadius: 2,
              background: live ? "var(--accent)" : "var(--ring-idle)",
              transformOrigin: `1px ${half}px`,
              transform: `rotate(${(i * 360) / bars}deg)`,
              transition: "background-color 200ms",
            }}
          />
        ))}
      </div>
      {children}
    </div>
  );
}
