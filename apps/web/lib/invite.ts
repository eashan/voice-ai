// Server-only: invite-code check + the signed "unlocked" cookie (httpOnly, 30 days).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const INVITE_COOKIE = "vf_invite";
export const INVITE_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** Best-effort brute-force brake (per serverless instance). The Fly-side budget is the real backstop. */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { n: number; resetAt: number }>();

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Cookie key derived from the session secret, so the two are never interchangeable. */
function cookieKey(): Buffer | null {
  const secret = process.env.SESSION_JWT_SECRET ?? "";
  if (secret.length < 32) return null;
  return createHmac("sha256", secret).update("vf-invite-cookie-v1").digest();
}

export type CodeCheck = { ok: true } | { ok: false; status: number; error: string };

/** Constant-time invite-code check with a per-IP attempt brake. */
export function checkInviteCode(code: string, ip: string): CodeCheck {
  const invite = process.env.DEMO_INVITE_CODE ?? "";
  const now = Date.now();
  const a = attempts.get(ip);
  const entry = a && a.resetAt > now ? a : { n: 0, resetAt: now + WINDOW_MS };
  if (entry.n >= MAX_ATTEMPTS) return { ok: false, status: 429, error: "Too many attempts. Try again later." };
  if (invite !== "" && code !== "" && timingSafeEqual(digest(code), digest(invite))) return { ok: true };
  entry.n++;
  attempts.set(ip, entry);
  return { ok: false, status: 401, error: code ? "That invite code isn't valid." : "An invite code is needed." };
}

/** `exp.sig`: proves this browser presented the invite code before. Rotating SESSION_JWT_SECRET revokes all. */
export function signInviteCookie(now = Date.now()): string | null {
  const key = cookieKey();
  if (!key) return null;
  const exp = Math.floor(now / 1000) + INVITE_COOKIE_MAX_AGE;
  const sig = createHmac("sha256", key).update(String(exp)).digest("base64url");
  return `${exp}.${sig}`;
}

export function verifyInviteCookie(value: string | undefined): boolean {
  const key = cookieKey();
  if (!key || !value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) <= Date.now() / 1000) return false;
  const expected = createHmac("sha256", key).update(exp).digest();
  const got = Buffer.from(sig, "base64url");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Read one cookie from the request header (route handlers get a plain Request). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function inviteCookieHeader(value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${INVITE_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${INVITE_COOKIE_MAX_AGE}${secure}`;
}

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
