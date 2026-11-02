import { appendFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { TurnLatencyRecord } from "@voiceforge/shared";

const LOG_DIR = fileURLToPath(new URL("../../../../logs/", import.meta.url));

/** Fire-and-forget: never awaited on the hot path (PRD LR-12). */
export function logTurn(record: TurnLatencyRecord): void {
  const file = `${LOG_DIR}latency-${record.wallClock.slice(0, 10)}.jsonl`;
  mkdir(LOG_DIR, { recursive: true })
    .then(() => appendFile(file, JSON.stringify(record) + "\n"))
    .catch((err) => console.error("[latency] log write failed", err));
}

/** Monotonic ms clock for stage timestamps. */
export const now = (): number => performance.now();
