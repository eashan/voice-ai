import { INVITE_COOKIE, checkInviteCode, clientIp, inviteCookieHeader, readCookie, signInviteCookie, verifyInviteCookie } from "../../../lib/invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Is this browser unlocked? (The cookie is httpOnly, so the page has to ask.) */
export async function GET(req: Request) {
  return Response.json(
    { unlocked: verifyInviteCookie(readCookie(req, INVITE_COOKIE)) },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Check the invite code once; on success, set the 30-day unlock cookie. */
export async function POST(req: Request) {
  let code = "";
  try {
    const body = (await req.json()) as { code?: unknown };
    if (typeof body.code === "string") code = body.code.trim();
  } catch {
    // empty code
  }
  const check = checkInviteCode(code, clientIp(req));
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });
  const cookie = signInviteCookie();
  if (!cookie) return Response.json({ error: "Demo is not configured." }, { status: 503 });
  return Response.json({ unlocked: true }, { headers: { "set-cookie": inviteCookieHeader(cookie), "cache-control": "no-store" } });
}
