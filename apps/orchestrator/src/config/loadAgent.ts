import { readFileSync } from "node:fs";
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

/** Static content first so the prompt-cache prefix stays stable (PRD LR-4). */
export function buildSystemPrompt(agent: AgentConfig): string {
  return `${agent.systemPrompt}\n\n${VOICE_STYLE_BLOCK}`;
}
