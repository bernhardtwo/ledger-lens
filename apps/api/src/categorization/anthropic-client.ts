/**
 * Real `CategorizationClient` over `@anthropic-ai/sdk` (see ADR-0006). This is the
 * one place the Claude API is called. The pure core (`core.ts`) imports none of
 * this; tests inject a mock instead.
 *
 * The SDK client is built **lazily** so the app/DI can boot without an API key
 * (only an actual categorize call needs `ANTHROPIC_API_KEY`). One forced tool call
 * per batch; returns the raw tool input for the core to validate.
 */
import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES } from "@ledger-lens/shared";
import {
  CATEGORIZATION_SYSTEM_PROMPT,
  CATEGORIZATION_TOOL_NAME,
  buildUserMessage,
} from "./prompt.js";
import type { CategorizationClient, CategorizationItem } from "./types.js";

/** Default categorization model when `ANTHROPIC_CATEGORIZATION_MODEL` is unset. */
export const DEFAULT_CATEGORIZATION_MODEL = "claude-haiku-4-5";

/**
 * Bounded output. A batch of `{index, category}` labels is small (~35 tokens each),
 * but a full batch of 50 approaches ~2k tokens — 4096 keeps comfortable headroom so
 * the tool call is never truncated (which would degrade the whole batch).
 */
const MAX_TOKENS = 4096;

/** Bound a hung request so a sequential multi-batch run can't stall indefinitely. */
const REQUEST_TIMEOUT_MS = 30_000;

const CATEGORIZATION_TOOL: Anthropic.Tool = {
  name: CATEGORIZATION_TOOL_NAME,
  description: "Record exactly one category for each numbered transaction.",
  input_schema: {
    type: "object",
    properties: {
      categorizations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "The transaction's 1-based index." },
            category: { type: "string", enum: [...CATEGORIES] },
          },
          required: ["index", "category"],
          additionalProperties: false,
        },
      },
    },
    required: ["categorizations"],
    additionalProperties: false,
  },
};

export class AnthropicCategorizationClient implements CategorizationClient {
  readonly modelId: string;
  private client: Anthropic | null = null;

  constructor(
    private readonly apiKey: string | undefined,
    modelId: string,
  ) {
    this.modelId = modelId;
  }

  private sdk(): Anthropic {
    if (this.apiKey === undefined || this.apiKey === "") {
      throw new Error("ANTHROPIC_API_KEY is required for transaction categorization");
    }
    if (this.client === null) {
      // maxRetries: SDK retries 429/5xx with backoff; timeout bounds a hung call.
      this.client = new Anthropic({
        apiKey: this.apiKey,
        maxRetries: 2,
        timeout: REQUEST_TIMEOUT_MS,
      });
    }
    return this.client;
  }

  async categorize(items: readonly CategorizationItem[]): Promise<unknown> {
    const response = await this.sdk().messages.create({
      model: this.modelId,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: CATEGORIZATION_SYSTEM_PROMPT,
      tools: [CATEGORIZATION_TOOL],
      tool_choice: { type: "tool", name: CATEGORIZATION_TOOL_NAME },
      messages: [{ role: "user", content: buildUserMessage(items) }],
    });

    const block = response.content.find(
      (content): content is Anthropic.ToolUseBlock =>
        content.type === "tool_use" && content.name === CATEGORIZATION_TOOL_NAME,
    );
    // Raw, unvalidated tool input (or undefined if the model returned no tool call);
    // the pure core validates and falls back.
    return block?.input;
  }
}
