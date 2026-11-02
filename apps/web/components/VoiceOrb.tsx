"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

const BARS = 48;
const IDLE_H = 10;
const MIN_H = 14;
const MAX_H = 40;
/** Scatter the useful voice bins (≈125 Hz–3 kHz) around the ring so it doesn't look top-heavy. */
const binFor = (i: number) => 1 + ((i * 7) % 24);

interface Props {
  live: boolean;
  /** Fills the buffer with 0–255 per frequency bin; false when no audio graph. */
  readSpectrum: (out: Uint8Array<ArrayBuffer>) => boolean;
  spectrumSize: number;
}

/**
 * Hero orb: circular photo inside 48 radial bars. Idle bars rest at 10px; during a call their heights follow
 * the live audio (agent playback or mic, whichever is louder).
 */
export function VoiceOrb({ live, readSpectrum, spectrumSize }: Props) {
  const bars = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    if (!live) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // static live ring
    const bins = new Uint8Array(spectrumSize);
    let raf = 0;
    const tick = () => {
      if (readSpectrum(bins)) {
        for (let i = 0; i < BARS; i++) {
          const b = binFor(i);
          // Higher bins are quieter in speech: lift them a little.
          const v = Math.min(1, (bins[b]! / 255) * (1 + b / 16));
          const el = bars.current[i];
          if (el) el.style.height = `${MIN_H + v * (MAX_H - MIN_H)}px`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, readSpectrum, spectrumSize]);

  return (
    <div style={{ position: "relative", width: 280, height: 280, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: BARS }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              bars.current[i] = el;
            }}
            style={{
              position: "absolute",
              left: 139,
              top: 0,
              width: 2,
              height: live ? 22 : IDLE_H,
              borderRadius: 2,
              background: live ? "var(--accent)" : "var(--ring-idle)",
              transformOrigin: "1px 140px",
              transform: `rotate(${i * 7.5}deg)`,
              transition: "background-color 200ms",
            }}
          />
        ))}
      </div>
      <Image
        src="/eashan-headshot.jpg"
        alt="Eashan Kadam"
        width={188}
        height={188}
        priority
        style={{
          borderRadius: "50%",
          objectFit: "cover",
          border: "3px solid var(--bg)",
          boxShadow: "0 0 0 1px var(--line)",
          position: "relative",
        }}
      />
    </div>
  );
}
