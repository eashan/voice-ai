import { appendFile, mkdir } from "node:fs/promises";
import { DATA_DIR } from "../config/env.js";
import type { TurnLatencyRecord } from "@voiceforge/shared";

const LOG_DIR = DATA_DIR.endsWith("/") ? DATA_DIR : `${DATA_DIR}/`;

/** Fire-and-forget: never awaited on the hot path (PRD LR-12). */
export function logTurn(record: TurnLatencyRecord): void {
  // One-line summary to stdout too (visible in `fly logs`).
  const v2v = record.serverV2vMs != null ? `${record.serverV2vMs.toFixed(0)} ms` : "–";
  console.log(`[turn] ${record.sessionId.slice(0, 8)} #${record.turnId} v2v=${v2v}${record.interrupted ? " (interrupted)" : ""}`);
  const file = `${LOG_DIR}latency-${record.wallClock.slice(0, 10)}.jsonl`;
  mkdir(LOG_DIR, { recursive: true })
    .then(() => appendFile(file, JSON.stringify(record) + "\n"))
    .catch((err) => console.error("[latency] log write failed", err));
}

/** Monotonic ms clock for stage timestamps. */
export const now = (): number => performance.now();
