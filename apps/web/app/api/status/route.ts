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
 * Availability per caller tier for the UI: `status` = public (concierge), `invited` = demo agents. Also the pre-warm: hitting /healthz wakes the Fly machine
 * (auto-stopped when idle; cold boot ≈ 10 s) while the visitor is still reading the page.
 */
export async function GET() {
  const ws = process.env.ORCHESTRATOR_WS_URL ?? process.env.NEXT_PUBLIC_ORCHESTRATOR_WS_URL ?? "ws://localhost:8787/ws";
  const url = new URL("/healthz", ws.replace(/^ws/, "http"));
  let status: AgentAvailability = "unknown";
  let invited: AgentAvailability = "unknown";
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const h = (await res.json()) as Healthz;
    const of = (t: TierStatus | undefined): AgentAvailability => {
      if (h.enabled === false || (t?.budgetLeftMinutes ?? h.budgetLeftMinutes ?? 1) <= 0) return "resting";
      if (t ? !t.slotFree : h.maxConcurrent != null && (h.activeCalls ?? 0) >= h.maxConcurrent) return "busy";
      return "ready";
    };
    status = of(h.tiers?.public); // the hero's concierge
    invited = of(h.tiers?.invited); // the demo cards
  } catch {
    // unreachable or still booting: the call attempt itself will tell
  }
  return Response.json({ status, invited }, { headers: { "cache-control": "no-store" } });
}
