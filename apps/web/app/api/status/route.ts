export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AgentAvailability = "ready" | "busy" | "resting" | "unknown";

interface Healthz {
  enabled?: boolean;
  activeCalls?: number;
  maxConcurrent?: number;
  budgetLeftMinutes?: number;
}

/**
 * Orchestrator availability for the UI. Also the pre-warm: hitting /healthz wakes the Fly machine
 * (auto-stopped when idle; cold boot ≈ 10 s) while the visitor is still reading the page.
 */
export async function GET() {
  const ws = process.env.ORCHESTRATOR_WS_URL ?? process.env.NEXT_PUBLIC_ORCHESTRATOR_WS_URL ?? "ws://localhost:8787/ws";
  const url = new URL("/healthz", ws.replace(/^ws/, "http"));
  let status: AgentAvailability = "unknown";
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const h = (await res.json()) as Healthz;
    if (h.enabled === false || (h.budgetLeftMinutes ?? 1) <= 0) status = "resting";
    else if (h.maxConcurrent != null && (h.activeCalls ?? 0) >= h.maxConcurrent) status = "busy";
    else status = "ready";
  } catch {
    // unreachable or still booting: the call attempt itself will tell
  }
  return Response.json({ status }, { headers: { "cache-control": "no-store" } });
}
