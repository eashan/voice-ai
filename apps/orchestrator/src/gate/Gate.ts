import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "@voiceforge/shared";
import {
  MIN_SECRET_LENGTH,
  sandboxHash,
  verifySessionToken,
  type SessionClaims,
  type SessionTier,
} from "@voiceforge/shared/sessionToken";
import { sandboxAgent, validSandbox, type SandboxInput } from "../config/loadAgent.js";
import { DATA_DIR, LIMITS } from "../config/env.js";

export type Rejection = "disabled" | "unauthorized" | "forbidden" | "sandbox_mismatch" | "busy" | "budget_exhausted";

export type Admission =
  | { ok: true; claims: SessionClaims; tier: SessionTier; agent: AgentConfig; sandbox: SandboxInput | null }
  | { ok: false; reason: Rejection; message: string };

const TIERS: SessionTier[] = ["public", "invited"];
const USAGE_FILE = join(DATA_DIR, "usage.json");
const today = () => new Date().toISOString().slice(0, 10); // UTC day

type Usage = { day: string; seconds: Record<SessionTier, number> };

/**
 * Admission control for the demo site: kill switch, signed single-use session token, agent registry +
 * per-agent access, concurrency cap (with slots reserved for invited callers) and a daily minute budget per
 * caller tier (persisted, so restarts don't reset it).
 * Single process only — fine for one Fly machine; M1 moves this to Redis.
 */
export class Gate {
  private readonly secret: string;
  private readonly usedJtis = new Map<string, number>(); // jti → exp (s)
  private readonly active = new Map<string, { start: number; tier: SessionTier }>(); // sessionId → call
  private usage: Usage;

  constructor(private readonly registry: Map<string, AgentConfig>) {
    const secret = process.env.SESSION_JWT_SECRET ?? "";
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`SESSION_JWT_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters`);
    }
    this.secret = secret;
    this.usage = this.loadUsage();
  }

  /**
   * `sandbox` = the prompt + greeting from a playground `start`. Used only if the token carries their hash
   * (`ph`, signed by /api/session after the invite check); otherwise ignored.
   */
  admit(token: unknown, sandbox: { prompt?: unknown; greeting?: unknown } = {}): Admission {
    if (!LIMITS.enabled) return { ok: false, reason: "disabled", message: "The demo is paused right now." };
    const claims = typeof token === "string" ? verifySessionToken(token, this.secret) : null;
    const agent = claims ? this.registry.get(claims.aid) : undefined;
    if (!claims || !agent || claims.wid !== agent.workspaceId || this.usedJtis.has(claims.jti)) {
      return { ok: false, reason: "unauthorized", message: "Invalid or expired session token." };
    }
    const tier: SessionTier = claims.tier ?? "public";
    if (agent.access === "invited" && tier !== "invited") {
      return { ok: false, reason: "forbidden", message: "This demo needs an invite code." };
    }
    let input: SandboxInput | null = null;
    if (claims.ph !== undefined) {
      if (tier !== "invited") {
        return { ok: false, reason: "forbidden", message: "The playground needs an invite code." };
      }
      input = validSandbox(sandbox);
      if (!input || sandboxHash(input.greeting, input.prompt) !== claims.ph) {
        return { ok: false, reason: "sandbox_mismatch", message: "The prompt doesn't match this session." };
      }
    }
    if (!this.hasSlot(tier)) {
      return { ok: false, reason: "busy", message: "The demo is busy. Try again in a few minutes." };
    }
    if (this.budgetLeftSeconds(tier) <= 0) {
      return { ok: false, reason: "budget_exhausted", message: "Today's demo minutes are used up. Try again tomorrow." };
    }
    this.usedJtis.set(claims.jti, claims.exp);
    this.pruneJtis();
    return { ok: true, claims, tier, agent: input ? sandboxAgent(agent, input) : agent, sandbox: input };
  }

  /** Reserve a slot synchronously right after admit() (before any await) so concurrent starts can't overshoot. */
  begin(sessionId: string, tier: SessionTier): void {
    this.active.set(sessionId, { start: Date.now(), tier });
  }

  end(sessionId: string): void {
    const call = this.active.get(sessionId);
    if (!call) return;
    this.active.delete(sessionId);
    this.rollDay();
    this.usage.seconds[call.tier] += (Date.now() - call.start) / 1000;
    this.saveUsage();
  }

  /** Invited callers may use any slot; public callers leave `reservedInvitedSlots` free. */
  private hasSlot(tier: SessionTier): boolean {
    if (this.active.size >= LIMITS.maxConcurrent) return false;
    if (tier === "invited") return true;
    const publicCap = Math.max(0, LIMITS.maxConcurrent - LIMITS.reservedInvitedSlots);
    return this.activeCount("public") < publicCap;
  }

  private activeCount(tier: SessionTier): number {
    let n = 0;
    for (const c of this.active.values()) if (c.tier === tier) n++;
    return n;
  }

  /** Remaining daily budget for a tier, counting that tier's calls in progress. */
  budgetLeftSeconds(tier: SessionTier): number {
    this.rollDay();
    const now = Date.now();
    let live = 0;
    for (const c of this.active.values()) if (c.tier === tier) live += (now - c.start) / 1000;
    return LIMITS.budgetSeconds[tier] - this.usage.seconds[tier] - live;
  }

  status() {
    const tier = (t: SessionTier) => ({
      budgetLeftMinutes: Math.max(0, Math.floor(this.budgetLeftSeconds(t) / 60)),
      activeCalls: this.activeCount(t),
      slotFree: this.hasSlot(t),
    });
    return {
      enabled: LIMITS.enabled,
      activeCalls: this.active.size,
      maxConcurrent: LIMITS.maxConcurrent,
      /** Public tier, kept for older clients. */
      budgetLeftMinutes: Math.max(0, Math.floor(this.budgetLeftSeconds("public") / 60)),
      tiers: { public: tier("public"), invited: tier("invited") },
    };
  }

  private rollDay(): void {
    if (this.usage.day !== today()) this.usage = { day: today(), seconds: { public: 0, invited: 0 } };
  }

  private pruneJtis(): void {
    const nowS = Date.now() / 1000;
    for (const [jti, exp] of this.usedJtis) if (exp < nowS) this.usedJtis.delete(jti);
  }

  private loadUsage(): Usage {
    const fresh: Usage = { day: today(), seconds: { public: 0, invited: 0 } };
    try {
      const u = JSON.parse(readFileSync(USAGE_FILE, "utf8")) as { day?: string; seconds?: unknown };
      if (u.day !== today()) return fresh;
      // Pre-tier format: { day, seconds: number } → count it all as public.
      if (typeof u.seconds === "number") return { day: u.day, seconds: { public: u.seconds, invited: 0 } };
      const s = u.seconds as Partial<Record<SessionTier, unknown>>;
      for (const t of TIERS) if (typeof s?.[t] === "number") fresh.seconds[t] = s[t] as number;
      return fresh;
    } catch {
      return fresh; // first run
    }
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
