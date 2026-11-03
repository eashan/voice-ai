import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AgentConfigSchema, VOICE_STYLE_BLOCK, type AgentConfig } from "@voiceforge/shared";

const AGENTS_DIR = new URL("../../agents/", import.meta.url);

/**
 * M0: agent JSON + a markdown prompt file next to it (`systemPromptFile`), resolved into `systemPrompt`.
 * M1: a row in Postgres with the same AgentConfig shape. Loaded once per session (PRD LR-12).
 */
export function loadAgent(name = "portfolio-concierge"): AgentConfig {
  const read = (file: string) => readFileSync(fileURLToPath(new URL(file, AGENTS_DIR)), "utf8");
  const raw = JSON.parse(read(`${name}.json`)) as Record<string, unknown>;
  if (typeof raw.systemPromptFile === "string") {
    raw.systemPrompt = read(raw.systemPromptFile);
    delete raw.systemPromptFile;
  }
  return AgentConfigSchema.parse(raw);
}

/**
 * Every agent in agents/ (one `<name>.json` each, optionally with a prompt file), keyed by agentId.
 * M1: the agents table, scoped by workspace.
 */
export function loadAgents(): Map<string, AgentConfig> {
  const registry = new Map<string, AgentConfig>();
  const files = readdirSync(fileURLToPath(AGENTS_DIR)).filter((f) => f.endsWith(".json"));
  for (const f of files.sort()) {
    const agent = loadAgent(f.replace(/\.json$/, ""));
    if (registry.has(agent.agentId)) throw new Error(`duplicate agentId ${agent.agentId} in ${f}`);
    registry.set(agent.agentId, agent);
  }
  if (registry.size === 0) throw new Error("no agents found in agents/");
  return registry;
}

/** `{{TODAY:Asia/Kolkata}}` → "Tuesday, 3 November 2026" in that time zone (demo agents read dates back). */
const TODAY_RE = /\{\{TODAY:([A-Za-z_]+\/[A-Za-z_]+)\}\}/g;
function fillToday(text: string, at = new Date()): string {
  return text.replace(TODAY_RE, (_m, timeZone: string) =>
    at.toLocaleDateString("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }),
  );
}

/**
 * Static content first so the prompt-cache prefix stays stable (PRD LR-4). Built once per session, so a
 * {{TODAY:…}} date only changes the prefix across days.
 */
export function buildSystemPrompt(agent: AgentConfig): string {
  return `${fillToday(agent.systemPrompt)}\n\n${VOICE_STYLE_BLOCK}`;
}
