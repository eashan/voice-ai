/** Server-only: Turnstile is on only when BOTH keys are set. Until then the concierge falls back to the invite code. */
export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
}

/** The public site key to hand to the page, or null while Turnstile is off. */
export function turnstileSiteKey(): string | null {
  return turnstileEnabled() ? process.env.TURNSTILE_SITE_KEY! : null;
}
