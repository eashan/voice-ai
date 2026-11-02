import { createHash, timingSafeEqual } from "node:crypto";
import { signSessionToken, MIN_SECRET_LENGTH } from "@voiceforge/shared/sessionToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Must match the orchestrator's agent config. M1: comes from the signed-in workspace. */
const WORKSPACE_ID = "ws_demo";
const AGENT_ID = "agent_portfolio_concierge";
const TOKEN_TTL_SECONDS = 60;

/** Best-effort brute-force brake (per serverless instance). Provider spend limits are the real backstop. */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { n: number; resetAt: number }>();

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Exchange the invite code for a short-lived, single-use session token + the orchestrator URL. */
export async function POST(req: Request) {
  const secret = process.env.SESSION_JWT_SECRET ?? "";
  const invite = process.env.DEMO_INVITE_CODE ?? "";
  if (secret.length < MIN_SECRET_LENGTH || !invite) {
    return Response.json({ error: "Demo is not configured." }, { status: 503 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const a = attempts.get(ip);
  const entry = a && a.resetAt > now ? a : { n: 0, resetAt: now + WINDOW_MS };
  if (entry.n >= MAX_ATTEMPTS) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });

  let code = "";
  try {
    const body = (await req.json()) as { code?: unknown };
    if (typeof body.code === "string") code = body.code.trim();
  } catch {
    // fall through: empty code
  }
  if (!timingSafeEqual(digest(code), digest(invite))) {
    entry.n++;
    attempts.set(ip, entry);
    return Response.json({ error: "That invite code isn't valid." }, { status: 401 });
  }

  const token = signSessionToken(secret, { wid: WORKSPACE_ID, aid: AGENT_ID }, TOKEN_TTL_SECONDS);
  const wsUrl =
    process.env.ORCHESTRATOR_WS_URL ?? process.env.NEXT_PUBLIC_ORCHESTRATOR_WS_URL ?? "ws://localhost:8787/ws";
  return Response.json({ token, wsUrl }, { headers: { "cache-control": "no-store" } });
}
