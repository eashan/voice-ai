// Usage: npx tsx --env-file=.env scripts/count-prompt-tokens.ts
// Checks the Anthropic key and that the system prompt clears the 512-token cache minimum (Haiku 5.5).
import Anthropic from "@anthropic-ai/sdk";
import { loadAgent, buildSystemPrompt } from "../apps/orchestrator/src/config/loadAgent.js";

const agent = loadAgent();
const client = new Anthropic();
const res = await client.messages.countTokens({
  model: agent.llm.model,
  system: buildSystemPrompt(agent),
  messages: [{ role: "user", content: "Hi" }],
});
console.log(`${agent.llm.model}: ${res.input_tokens} input tokens (cache minimum 512)`);
