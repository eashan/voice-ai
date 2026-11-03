import { SANDBOX_LIMITS } from "@voiceforge/shared/sandbox";
import { signSessionToken, sandboxHash, MIN_SECRET_LENGTH, type SessionTier } from "@voiceforge/shared/sessionToken";
import { turnstileEnabled } from "../../../lib/turnstileConfig";
import {
  INVITE_COOKIE,
  checkInviteCode,
  clientIp,
  inviteCookieHeader,
  readCookie,
  signInviteCookie,
  verifyInviteCookie,
} from "../../../lib/invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Must match the orchestrator's agent configs. M1: comes from the signed-in workspace. */
const WORKSPACE_ID = "ws_demo";
const DEFAULT_AGENT_ID = "agent_portfolio_concierge";
/** Shape check only: the orchestrator's registry decides whether the agent exists and who may call it. */
const AGENT_ID_RE = /^agent_[a-z0-9_]{1,48}$/;
const TOKEN_TTL_SECONDS = 60;

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
 * Proof (→ tier): a Turnstile token (→ public), the unlock cookie (→ invited) or the invite code (→ invited, and
 * sets the cookie). The orchestrator decides whether that tier may call the requested agent.
 * Playground calls also send `prompt` + `greeting`: invited proof only, capped, and their hash is signed into the
 * token (`ph`) so the orchestrator can check the browser sends the same text on `start`.
 */
export async function POST(req: Request) {
  const secret = process.env.SESSION_JWT_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    return Response.json({ error: "Demo is not configured." }, { status: 503 });
  }

  const ip = clientIp(req);
  let code = "";
  let turnstileToken = "";
  let agentId = DEFAULT_AGENT_ID;
  let prompt: unknown;
  let greeting: unknown;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.code === "string") code = body.code.trim();
    if (typeof body.turnstileToken === "string") turnstileToken = body.turnstileToken;
    if (typeof body.agentId === "string") agentId = body.agentId;
    ({ prompt, greeting } = body);
  } catch {
    // fall through: no proof in the body
  }
  if (!AGENT_ID_RE.test(agentId)) return Response.json({ error: "Unknown agent." }, { status: 400 });

  let ph: string | undefined;
  if (prompt !== undefined || greeting !== undefined) {
    if (typeof prompt !== "string" || !prompt.trim() || typeof greeting !== "string" || !greeting.trim()) {
      return Response.json({ error: "The prompt and greeting can't be empty." }, { status: 400 });
    }
    if (prompt.length > SANDBOX_LIMITS.promptChars || greeting.length > SANDBOX_LIMITS.greetingChars) {
      return Response.json(
        { error: `Keep the prompt under ${SANDBOX_LIMITS.promptChars.toLocaleString("en-US")} characters and the greeting under ${SANDBOX_LIMITS.greetingChars}.` },
        { status: 400 },
      );
    }
    ph = sandboxHash(greeting, prompt);
  }

  let tier: SessionTier;
  let setCookie: string | null = null;
  // The playground is invite-only: a Turnstile pass isn't enough for a custom prompt.
  if (turnstileEnabled() && turnstileToken && !ph) {
    if (!(await verifyTurnstile(turnstileToken, ip))) {
      return Response.json({ error: "Couldn't verify the request. Please try again." }, { status: 401 });
    }
    tier = "public";
  } else if (verifyInviteCookie(readCookie(req, INVITE_COOKIE))) {
    tier = "invited";
  } else {
    const check = checkInviteCode(code, ip);
    if (!check.ok) return Response.json({ error: check.error, needsCode: true }, { status: check.status });
    tier = "invited";
    const cookie = signInviteCookie();
    if (cookie) setCookie = inviteCookieHeader(cookie);
  }

  const token = signSessionToken(secret, { wid: WORKSPACE_ID, aid: agentId, tier, ...(ph ? { ph } : {}) }, TOKEN_TTL_SECONDS);
  const wsUrl =
    process.env.ORCHESTRATOR_WS_URL ?? process.env.NEXT_PUBLIC_ORCHESTRATOR_WS_URL ?? "ws://localhost:8787/ws";
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (setCookie) headers["set-cookie"] = setCookie;
  return Response.json({ token, wsUrl }, { headers });
}
