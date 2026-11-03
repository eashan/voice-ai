export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AgentAvailability = "ready" | "busy" | "resting" | "unknown";

interface TierStatus {
  budgetLeftMinutes: number;
  slotFree: boolean;
}
interface Healthz {
  enabled?: boolean;
  activeCalls?: number;
  maxConcurrent?: number;
  budgetLeftMinutes?: number;
  tiers?: { public: TierStatus; invited: TierStatus };
}

/**
 * Concierge (public tier) availability for the UI. Also the pre-warm: hitting /healthz wakes the Fly machine
 * (auto-stopped when idle; cold boot ≈ 10 s) while the visitor is still reading the page.
 */
export async function GET() {
  const ws = process.env.ORCHESTRATOR_WS_URL ?? process.env.NEXT_PUBLIC_ORCHESTRATOR_WS_URL ?? "ws://localhost:8787/ws";
  const url = new URL("/healthz", ws.replace(/^ws/, "http"));
  let status: AgentAvailability = "unknown";
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const h = (await res.json()) as Healthz;
    // The hero's concierge is a public-tier call.
    const pub = h.tiers?.public;
    if (h.enabled === false || (pub?.budgetLeftMinutes ?? h.budgetLeftMinutes ?? 1) <= 0) status = "resting";
    else if (pub ? !pub.slotFree : h.maxConcurrent != null && (h.activeCalls ?? 0) >= h.maxConcurrent) status = "busy";
    else status = "ready";
  } catch {
    // unreachable or still booting: the call attempt itself will tell
  }
  return Response.json({ status }, { headers: { "cache-control": "no-store" } });
}
