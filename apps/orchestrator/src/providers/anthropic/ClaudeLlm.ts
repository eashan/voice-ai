import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig } from "@voiceforge/shared";
import type { ChatMessage, LlmProvider, LlmTurn, LlmTurnResult } from "../types.js";

/** One shared client per process: keeps the HTTP keep-alive pool warm (PRD LR-3). */
let sharedClient: Anthropic | null = null;
const client = () => (sharedClient ??= new Anthropic());

const REFUSAL_LINE = "Sorry, I can't help with that one. Ask me anything about Eashan's work.";

/**
 * Claude streaming for voice. Settings come from the agent config (concierge: Haiku 4.5, thinking off,
 * no effort parameter). The system prompt carries an explicit cache breakpoint; top-level automatic caching
 * covers the growing conversation tail.
 */
export class ClaudeLlm implements LlmProvider {
  constructor(private readonly cfg: AgentConfig["llm"]) {}

  /** Same model/thinking/effort as real traffic, or the warm entry won't be hit. */
  private shared(system: string) {
    return {
      model: this.cfg.model,
      thinking: this.cfg.thinking === "disabled" ? ({ type: "disabled" } as const) : ({ type: "adaptive" } as const),
      // Models without the effort parameter (Haiku 4.5) reject output_config.effort.
      ...(this.cfg.effort ? { output_config: { effort: this.cfg.effort } } : {}),
      system: [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }],
    };
  }

  async prewarm(system: string): Promise<void> {
    try {
      const res = await client().messages.create({
        ...this.shared(system),
        max_tokens: 0,
        messages: [{ role: "user", content: "warmup" }],
      });
      console.log(
        `[claude] prewarm: cache_creation=${res.usage.cache_creation_input_tokens ?? 0} cache_read=${res.usage.cache_read_input_tokens ?? 0}`,
      );
    } catch (err) {
      // Non-fatal: first turn just pays the cold-cache cost.
      console.warn("[claude] prewarm failed:", err instanceof Error ? err.message : err);
    }
  }

  streamTurn({ system, history }: { system: string; history: ChatMessage[] }): LlmTurn {
    const stream = client().messages.stream({
      ...this.shared(system),
      max_tokens: this.cfg.maxTokens,
      cache_control: { type: "ephemeral" },
      messages: history,
    });

    let text = "";
    let aborted = false;

    async function* textStream(): AsyncGenerator<string> {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            text += event.delta.text;
            yield event.delta.text;
          }
        }
      } catch (err) {
        if (!(err instanceof Anthropic.APIUserAbortError)) throw err;
      }
    }

    const done: Promise<LlmTurnResult> = stream
      .finalMessage()
      .then((msg): LlmTurnResult => {
        if (msg.stop_reason === "refusal") return { text: REFUSAL_LINE, aborted: false, refusal: true };
        return {
          text,
          aborted: false,
          cacheReadInputTokens: msg.usage.cache_read_input_tokens ?? undefined,
          cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? undefined,
        };
      })
      .catch((err): LlmTurnResult => {
        if (aborted || err instanceof Anthropic.APIUserAbortError) return { text, aborted: true };
        let msg = err instanceof Error ? err.message : String(err);
        if (err instanceof Anthropic.RateLimitError) msg = `rate_limited: ${msg}`;
        else if (err instanceof Anthropic.APIConnectionError) msg = `connection: ${msg}`;
        return { text, aborted: false, error: msg };
      });

    return {
      textStream: textStream(),
      abort: () => {
        aborted = true;
        stream.abort();
      },
      done,
    };
  }
}
