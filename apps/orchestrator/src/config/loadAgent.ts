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

/** Static content first so the prompt-cache prefix stays stable (PRD LR-4). */
export function buildSystemPrompt(agent: AgentConfig): string {
  return `${agent.systemPrompt}\n\n${VOICE_STYLE_BLOCK}`;
}
