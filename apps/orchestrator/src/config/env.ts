import { fileURLToPath } from "node:url";

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** Where usage state + latency logs live. On Fly this is a mounted volume (/data). */
export const DATA_DIR = process.env.DATA_DIR ?? fileURLToPath(new URL("../../../../logs/", import.meta.url));

/** Demo cost gating (docs/M0_PLAN.md decision 6). All read once at boot; change via Fly secrets (restarts the app). */
export const LIMITS = {
  /** Kill switch: anything but "true" rejects every new call. */
  enabled: process.env.DEMO_ENABLED === "true",
  maxConcurrent: num("MAX_CONCURRENT_SESSIONS", 2),
  maxCallMs: num("MAX_CALL_SECONDS", 180) * 1000,
  silenceHangupMs: num("SILENCE_HANGUP_SECONDS", 20) * 1000,
  /** Daily minutes per caller tier (UTC day). Invited minutes are for invite-code holders (demo leads). */
  budgetSeconds: {
    public: num("PUBLIC_MINUTES", 40) * 60,
    invited: num("INVITED_MINUTES", 20) * 60,
  },
  /** Slots of maxConcurrent that public callers can't take, so an invited lead never hears "busy". */
  reservedInvitedSlots: Math.max(0, Number(process.env.RESERVED_INVITED_SLOTS ?? 1)),
};

/** Browser origins allowed to open a WebSocket (comma-separated). Unset = allow any (local dev only). */
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
