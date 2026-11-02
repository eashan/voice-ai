// Server-only (node:crypto). Imported via "@voiceforge/shared/sessionToken" so it never lands in the browser bundle.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, single-use session token (HS256 JWT) that lets one browser open one call.
 * Issued by the web app after the invite code checks out; verified by the orchestrator on `start`.
 * M1: issued after real auth, with the caller's real workspace/agent.
 */
export interface SessionClaims {
  /** workspaceId */
  wid: string;
  /** agentId */
  aid: string;
  /** Unique token id: the orchestrator accepts each jti once. */
  jti: string;
  iat: number;
  exp: number;
}

const b64url = (s: string) => Buffer.from(s).toString("base64url");
const HEADER = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

export const MIN_SECRET_LENGTH = 32;

export function signSessionToken(secret: string, claims: { wid: string; aid: string }, ttlSeconds = 60): string {
  const iat = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ ...claims, jti: randomUUID(), iat, exp: iat + ttlSeconds }));
  const sig = createHmac("sha256", secret).update(`${HEADER}.${payload}`).digest("base64url");
  return `${HEADER}.${payload}.${sig}`;
}

/** Returns the claims if the signature is valid and the token hasn't expired, else null. */
export function verifySessionToken(token: string, secret: string): SessionClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts as [string, string, string];
  if (header !== HEADER) return null; // pins alg=HS256
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const { wid, aid, jti, exp } = claims;
  if (typeof wid !== "string" || typeof aid !== "string" || typeof jti !== "string" || typeof exp !== "number") return null;
  if (exp <= Math.floor(Date.now() / 1000)) return null;
  return claims;
}
