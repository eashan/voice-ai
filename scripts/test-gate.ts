// Usage: npx tsx scripts/test-gate.ts
// Admission rules of the orchestrator's Gate: token × agent registry × caller tier, reserved slots, per-tier
// budgets and usage persistence. Runs against a temp DATA_DIR; touches no network.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const dataDir = mkdtempSync(join(tmpdir(), "gate-test-"));
const SECRET = "test-secret-".padEnd(48, "x");
Object.assign(process.env, {
  DATA_DIR: dataDir,
  DEMO_ENABLED: "true",
  SESSION_JWT_SECRET: SECRET,
  MAX_CONCURRENT_SESSIONS: "2",
  RESERVED_INVITED_SLOTS: "1",
  PUBLIC_MINUTES: "40",
  INVITED_MINUTES: "20",
});

// env.ts reads process.env at import time, so import after setting it.
const { AgentConfigSchema } = await import("@voiceforge/shared");
const { signSessionToken } = await import("@voiceforge/shared/sessionToken");
const { Gate } = await import("../apps/orchestrator/src/gate/Gate");

const base = {
  workspaceId: "ws_demo",
  version: 1,
  greeting: "Hi",
  systemPrompt: "x",
  llm: {},
  voice: { provider: "deepgram", voiceId: "aura-2-orpheus-en" },
  stt: { provider: "elevenlabs" },
  turnTaking: {},
};
const concierge = AgentConfigSchema.parse({ ...base, agentId: "agent_portfolio_concierge", name: "C", access: "public" });
const debt = AgentConfigSchema.parse({ ...base, agentId: "agent_debt_collection", name: "D", access: "invited" });
const unspecified = AgentConfigSchema.parse({ ...base, agentId: "agent_no_access", name: "U" });
const registry = new Map([concierge, debt, unspecified].map((a) => [a.agentId, a]));

const tok = (aid: string, tier?: "public" | "invited", wid = "ws_demo", secret = SECRET) =>
  signSessionToken(secret, tier ? { wid, aid, tier } : { wid, aid });

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const reason = (r: ReturnType<InstanceType<typeof Gate>["admit"]>) => (r.ok ? "ok" : r.reason);

console.log("token × agent × tier");
{
  const gate = new Gate(registry);
  check("public → public agent: ok", () => assert.equal(reason(gate.admit(tok("agent_portfolio_concierge", "public"))), "ok"));
  check("invited → public agent: ok", () => assert.equal(reason(gate.admit(tok("agent_portfolio_concierge", "invited"))), "ok"));
  check("invited → invited agent: ok", () => assert.equal(reason(gate.admit(tok("agent_debt_collection", "invited"))), "ok"));
  check("public → invited agent: forbidden", () => assert.equal(reason(gate.admit(tok("agent_debt_collection", "public"))), "forbidden"));
  check("no tier (old token) → invited agent: forbidden", () =>
    assert.equal(reason(gate.admit(tok("agent_debt_collection"))), "forbidden"));
  check("no tier (old token) → public agent: ok", () => assert.equal(reason(gate.admit(tok("agent_portfolio_concierge"))), "ok"));
  check("agent without access field defaults to invited", () =>
    assert.equal(reason(gate.admit(tok("agent_no_access", "public"))), "forbidden"));
  check("unknown agent: unauthorized", () => assert.equal(reason(gate.admit(tok("agent_nope", "invited"))), "unauthorized"));
  check("wrong workspace: unauthorized", () =>
    assert.equal(reason(gate.admit(tok("agent_portfolio_concierge", "invited", "ws_other"))), "unauthorized"));
  check("wrong secret: unauthorized", () =>
    assert.equal(reason(gate.admit(tok("agent_portfolio_concierge", "invited", "ws_demo", "y".repeat(48)))), "unauthorized"));
  check("garbage token: unauthorized", () => assert.equal(reason(gate.admit("a.b.c")), "unauthorized"));
  check("replayed token: unauthorized", () => {
    const t = tok("agent_portfolio_concierge", "public");
    assert.equal(reason(gate.admit(t)), "ok");
    assert.equal(reason(gate.admit(t)), "unauthorized");
  });
}

console.log("concurrency: 2 slots, 1 reserved for invited");
{
  const gate = new Gate(registry);
  gate.begin("p1", "public");
  check("2nd public call while 1 public active: busy", () =>
    assert.equal(reason(gate.admit(tok("agent_portfolio_concierge", "public"))), "busy"));
  check("invited call takes the reserved slot: ok", () =>
    assert.equal(reason(gate.admit(tok("agent_debt_collection", "invited"))), "ok"));
  gate.begin("i1", "invited");
  check("all slots full → invited: busy", () => assert.equal(reason(gate.admit(tok("agent_debt_collection", "invited"))), "busy"));
  gate.end("p1");
  check("public slot freed → public: ok", () => assert.equal(reason(gate.admit(tok("agent_portfolio_concierge", "public"))), "ok"));
  gate.end("i1");
  gate.begin("i2", "invited");
  gate.begin("i3", "invited");
  check("invited can use both slots; then public: busy", () =>
    assert.equal(reason(gate.admit(tok("agent_portfolio_concierge", "public"))), "busy"));
  gate.end("i2");
  gate.end("i3");
  const st = gate.status();
  check("status reports both tiers", () => {
    assert.equal(st.tiers.public.slotFree, true);
    assert.equal(st.tiers.invited.slotFree, true);
    assert.equal(st.maxConcurrent, 2);
  });
}

console.log("per-tier budgets + persistence");
{
  const day = new Date().toISOString().slice(0, 10);
  writeFileSync(join(dataDir, "usage.json"), JSON.stringify({ day, seconds: { public: 40 * 60, invited: 0 } }));
  const gate = new Gate(registry);
  check("public budget spent → public: budget_exhausted", () =>
    assert.equal(reason(gate.admit(tok("agent_portfolio_concierge", "public"))), "budget_exhausted"));
  check("invited budget untouched → invited: ok", () =>
    assert.equal(reason(gate.admit(tok("agent_portfolio_concierge", "invited"))), "ok"));
  check("status: public 0 min, invited 20 min", () => {
    assert.equal(gate.status().tiers.public.budgetLeftMinutes, 0);
    assert.equal(gate.status().tiers.invited.budgetLeftMinutes, 20);
  });

  writeFileSync(join(dataDir, "usage.json"), JSON.stringify({ day, seconds: 600 })); // pre-tier format
  const legacy = new Gate(registry);
  check("legacy usage.json counts as public", () => assert.equal(legacy.status().tiers.public.budgetLeftMinutes, 30));

  legacy.begin("x", "invited");
  legacy.end("x");
  const saved = JSON.parse(readFileSync(join(dataDir, "usage.json"), "utf8"));
  check("usage persisted per tier", () => {
    assert.equal(typeof saved.seconds.public, "number");
    assert.equal(typeof saved.seconds.invited, "number");
  });
}

console.log(`\n${passed} checks passed`);
