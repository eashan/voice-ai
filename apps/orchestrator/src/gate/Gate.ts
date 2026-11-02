import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MIN_SECRET_LENGTH, verifySessionToken, type SessionClaims } from "@voiceforge/shared/sessionToken";
import { DATA_DIR, LIMITS } from "../config/env.js";

export type Rejection = "disabled" | "unauthorized" | "busy" | "budget_exhausted";

const USAGE_FILE = join(DATA_DIR, "usage.json");
const today = () => new Date().toISOString().slice(0, 10); // UTC day

/**
 * Admission control for the public demo: kill switch, signed single-use session token,
 * concurrency cap and a daily minute budget (persisted, so restarts don't reset it).
 * Single process only — fine for one Fly machine; M1 moves this to Redis.
 */
export class Gate {
  private readonly secret: string;
  private readonly usedJtis = new Map<string, number>(); // jti → exp (s)
  private readonly active = new Map<string, number>(); // sessionId → start (ms, wall clock)
  private usage: { day: string; seconds: number };

  constructor(private readonly expected: { wid: string; aid: string }) {
    const secret = process.env.SESSION_JWT_SECRET ?? "";
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`SESSION_JWT_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters`);
    }
    this.secret = secret;
    this.usage = this.loadUsage();
  }

  admit(token: unknown): { ok: true; claims: SessionClaims } | { ok: false; reason: Rejection; message: string } {
    if (!LIMITS.enabled) return { ok: false, reason: "disabled", message: "The demo is paused right now." };
    const claims = typeof token === "string" ? verifySessionToken(token, this.secret) : null;
    if (!claims || claims.wid !== this.expected.wid || claims.aid !== this.expected.aid || this.usedJtis.has(claims.jti)) {
      return { ok: false, reason: "unauthorized", message: "Invalid or expired session token." };
    }
    if (this.active.size >= LIMITS.maxConcurrent) {
      return { ok: false, reason: "busy", message: "The demo is busy. Try again in a few minutes." };
    }
    if (this.budgetLeftSeconds() <= 0) {
      return { ok: false, reason: "budget_exhausted", message: "Today's demo minutes are used up. Try again tomorrow." };
    }
    this.usedJtis.set(claims.jti, claims.exp);
    this.pruneJtis();
    return { ok: true, claims };
  }

  /** Reserve a slot synchronously right after admit() (before any await) so concurrent starts can't overshoot. */
  begin(sessionId: string): void {
    this.active.set(sessionId, Date.now());
  }

  end(sessionId: string): void {
    const start = this.active.get(sessionId);
    if (start == null) return;
    this.active.delete(sessionId);
    this.rollDay();
    this.usage.seconds += (Date.now() - start) / 1000;
    this.saveUsage();
  }

  /** Remaining daily budget, counting calls in progress. */
  budgetLeftSeconds(): number {
    this.rollDay();
    const now = Date.now();
    let live = 0;
    for (const start of this.active.values()) live += (now - start) / 1000;
    return LIMITS.dailyBudgetSeconds - this.usage.seconds - live;
  }

  status() {
    return {
      enabled: LIMITS.enabled,
      activeCalls: this.active.size,
      budgetLeftMinutes: Math.max(0, Math.floor(this.budgetLeftSeconds() / 60)),
    };
  }

  private rollDay(): void {
    if (this.usage.day !== today()) this.usage = { day: today(), seconds: 0 };
  }

  private pruneJtis(): void {
    const nowS = Date.now() / 1000;
    for (const [jti, exp] of this.usedJtis) if (exp < nowS) this.usedJtis.delete(jti);
  }

  private loadUsage(): { day: string; seconds: number } {
    try {
      const u = JSON.parse(readFileSync(USAGE_FILE, "utf8"));
      if (u.day === today() && typeof u.seconds === "number") return u;
    } catch {
      // first run
    }
    return { day: today(), seconds: 0 };
  }

  private saveUsage(): void {
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(USAGE_FILE, JSON.stringify(this.usage));
    } catch (err) {
      console.error("[gate] failed to persist usage", err);
    }
  }
}
