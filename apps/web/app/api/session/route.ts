import { createHash, timingSafeEqual } from "node:crypto";
import { signSessionToken, MIN_SECRET_LENGTH, type SessionTier } from "@voiceforge/shared/sessionToken";
import { turnstileEnabled } from "../../../lib/turnstileConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Must match the orchestrator's agent configs. M1: comes from the signed-in workspace. */
const WORKSPACE_ID = "ws_demo";
const DEFAULT_AGENT_ID = "agent_portfolio_concierge";
/** Shape check only: the orchestrator's registry decides whether the agent exists and who may call it. */
const AGENT_ID_RE = /^agent_[a-z0-9_]{1,48}$/;
const TOKEN_TTL_SECONDS = 60;

/** Best-effort brute-force brake on invite codes (per serverless instance). The Fly-side budget is the real backstop. */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { n: number; resetAt: number }>();

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Cloudflare Turnstile server-side check. Tokens are single-use and valid for 5 minutes. */
async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY ?? "", response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  } catch {
    return false;
  }
}

/**
 * Exchange proof of a real visitor for a short-lived, single-use session token + the orchestrator URL.
 * Proof = a Turnstile token (when TURNSTILE_SECRET_KEY + TURNSTILE_SITE_KEY are set) or the invite code.
 */
export async function POST(req: Request) {
  const secret = process.env.SESSION_JWT_SECRET ?? "";
  const invite = process.env.DEMO_INVITE_CODE ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    return Response.json({ error: "Demo is not configured." }, { status: 503 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  let code = "";
  let turnstileToken = "";
  let agentId = DEFAULT_AGENT_ID;
  try {
    const body = (await req.json()) as { code?: unknown; turnstileToken?: unknown; agentId?: unknown };
    if (typeof body.code === "string") code = body.code.trim();
    if (typeof body.turnstileToken === "string") turnstileToken = body.turnstileToken;
    if (typeof body.agentId === "string") agentId = body.agentId;
  } catch {
    // fall through: no proof
  }
  if (!AGENT_ID_RE.test(agentId)) return Response.json({ error: "Unknown agent." }, { status: 400 });

  // Tier = what the visitor proved: the bot check → public; the invite code → invited.
  let tier: SessionTier;
  let admitted = false;
  if (turnstileEnabled() && turnstileToken) {
    tier = "public";
    admitted = await verifyTurnstile(turnstileToken, ip);
    if (!admitted) return Response.json({ error: "Couldn't verify the request. Please try again." }, { status: 401 });
  } else {
    tier = "invited";
    const now = Date.now();
    const a = attempts.get(ip);
    const entry = a && a.resetAt > now ? a : { n: 0, resetAt: now + WINDOW_MS };
    if (entry.n >= MAX_ATTEMPTS) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    admitted = invite !== "" && timingSafeEqual(digest(code), digest(invite));
    if (!admitted) {
      entry.n++;
      attempts.set(ip, entry);
      return Response.json(
        { error: code ? "That invite code isn't valid." : "An invite code is needed.", needsCode: true },
        { status: 401 },
      );
    }
  }

  const token = signSessionToken(secret, { wid: WORKSPACE_ID, aid: agentId, tier }, TOKEN_TTL_SECONDS);
  const wsUrl =
    process.env.ORCHESTRATOR_WS_URL ?? process.env.NEXT_PUBLIC_ORCHESTRATOR_WS_URL ?? "ws://localhost:8787/ws";
  return Response.json({ token, wsUrl }, { headers: { "cache-control": "no-store" } });
}
