"use client";

interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      appearance?: "always" | "execute" | "interaction-only";
      callback?: (token: string) => void;
      "error-callback"?: () => void;
      "timeout-callback"?: () => void;
    },
  ): string;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | null = null;

/** Load the Turnstile script once (call early to hide the latency). */
export function loadTurnstile(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load the bot check."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Run one Turnstile check in `container` and resolve with its single-use token. The widget only shows itself
 * if Cloudflare wants an interaction; most visitors never see it.
 */
export async function getTurnstileToken(container: HTMLElement, sitekey: string): Promise<string> {
  await loadTurnstile();
  const ts = window.turnstile;
  if (!ts) throw new Error("Couldn't load the bot check.");
  return new Promise<string>((resolve, reject) => {
    let id = "";
    const done = () => setTimeout(() => id && ts.remove(id), 0);
    id = ts.render(container, {
      sitekey,
      appearance: "interaction-only",
      callback: (token) => {
        done();
        resolve(token);
      },
      "error-callback": () => {
        done();
        reject(new Error("The bot check failed. Please try again."));
      },
      "timeout-callback": () => {
        done();
        reject(new Error("The bot check timed out. Please try again."));
      },
    });
  });
}
