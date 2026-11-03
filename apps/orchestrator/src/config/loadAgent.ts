import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentConfigSchema,
  SANDBOX_GUARD,
  SANDBOX_LIMITS,
  VOICE_STYLE_BLOCK,
  type AgentConfig,
} from "@voiceforge/shared";
import { DATA_DIR } from "./env.js";

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
  if (typeof raw.sandboxSuffixFile === "string") {
    raw.sandboxSuffix = read(raw.sandboxSuffixFile);
    delete raw.sandboxSuffixFile;
  }
  // The playground's default editor text; only the web app reads it (scripts/gen-playground-defaults.ts).
  delete raw.sandboxPromptFile;
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

export interface SandboxInput {
  prompt: string;
  greeting: string;
}

/** Shape + length check for a playground prompt (the web app checks the same, the orchestrator doesn't trust it). */
export function validSandbox(input: { prompt?: unknown; greeting?: unknown }): SandboxInput | null {
  const { prompt, greeting } = input;
  if (typeof prompt !== "string" || typeof greeting !== "string") return null;
  if (!prompt.trim() || prompt.length > SANDBOX_LIMITS.promptChars) return null;
  if (!greeting.trim() || greeting.length > SANDBOX_LIMITS.greetingChars) return null;
  return { prompt, greeting };
}

/**
 * Playground call: a copy of the base agent with the visitor's greeting and prompt. The prompt sits between the
 * locked guard and the agent's locked suffix (if any); buildSystemPrompt still appends the voice style block.
 */
export function sandboxAgent(base: AgentConfig, input: SandboxInput): AgentConfig {
  const parts = [SANDBOX_GUARD, input.prompt.trim()];
  if (base.sandboxSuffix) parts.push(base.sandboxSuffix.trim());
  return { ...base, greeting: input.greeting.trim(), systemPrompt: parts.join("\n\n") };
}

const SANDBOX_LOG = join(DATA_DIR, "sandbox-prompts.jsonl");

/** One line per playground call: enough to spot abuse, not the whole prompt. */
export async function logSandboxPrompt(sessionId: string, agentId: string, input: SandboxInput): Promise<void> {
  const line = {
    at: new Date().toISOString(),
    sessionId,
    agentId,
    hash: createHash("sha256").update(input.prompt).digest("hex").slice(0, 16),
    chars: input.prompt.length,
    greeting: input.greeting.slice(0, 200),
    prompt: input.prompt.slice(0, 200),
  };
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(SANDBOX_LOG, JSON.stringify(line) + "\n");
  } catch (err) {
    console.error(`[sandbox] couldn't log prompt: ${err instanceof Error ? err.message : String(err)}`);
  }
}
