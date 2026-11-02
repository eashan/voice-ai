import { z } from "zod";

/** Agent config. M0: loaded from JSON. M1: a row in Postgres (agent_versions), same shape. */
export const AgentConfigSchema = z.object({
  workspaceId: z.string(),
  agentId: z.string(),
  version: z.number().int().positive(),
  name: z.string(),
  greeting: z.string(),
  systemPrompt: z.string(),
  llm: z.object({
    model: z.string().default("claude-haiku-5-5"),
    thinking: z.enum(["disabled", "adaptive"]).default("disabled"),
    effort: z.enum(["low", "medium", "high"]).default("low"),
    maxTokens: z.number().int().positive().default(300),
  }),
  voice: z.object({
    provider: z.literal("deepgram"),
    voiceId: z.string(),
  }),
  stt: z.object({
    provider: z.literal("elevenlabs"),
    language: z.string().default("en"),
  }),
  turnTaking: z.object({
    endpointer: z.enum(["provider_vad", "silero_vad"]).default("provider_vad"),
    silenceMs: z.number().int().min(100).max(2000).default(300),
    bargeIn: z.boolean().default(true),
  }),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/** Appended to every system prompt (PRD LR-14). */
export const VOICE_STYLE_BLOCK = [
  "You are speaking out loud in a real-time voice conversation.",
  "Respond in 1-3 short sentences unless the user asks for detail.",
  "Never use markdown, bullet points, lists, emojis, or URLs. Write numbers the way they are spoken.",
].join(" ");
