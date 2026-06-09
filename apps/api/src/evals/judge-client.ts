/**
 * The LLM-as-judge client (see ADR-0009 §6): one cheap Claude call that scores an
 * answer's quality, **reported only, never gating**. The pure prompt/parse helpers
 * live in `@ledger-lens/evals`; this wraps the `@anthropic-ai/sdk` call (the same
 * SDK the categoriser uses). Used only behind the runner's `--judge` flag.
 */
import Anthropic from "@anthropic-ai/sdk";
import { type JudgeVerdict, parseJudgeVerdict } from "@ledger-lens/evals";

const MAX_TOKENS = 512;
const REQUEST_TIMEOUT_MS = 30_000;

export class JudgeClient {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: REQUEST_TIMEOUT_MS });
  }

  async judge(prompt: { system: string; user: string }): Promise<JudgeVerdict> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return parseJudgeVerdict(text);
  }
}
