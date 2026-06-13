import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../lib/contracts";
import { Chat } from "./Chat";

vi.mock("../lib/sse", () => ({ streamAgent: vi.fn() }));
import { streamAgent } from "../lib/sse";

async function* gen(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) {
    yield event;
  }
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function ask(question: string): void {
  fireEvent.change(screen.getByLabelText("Ask a question"), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

describe("Chat", () => {
  it("renders the user message, the tool trail (no figures), the answer, and a footer", async () => {
    vi.mocked(streamAgent).mockReturnValue(
      gen([
        {
          type: "tool_call",
          tool: "summarize_account",
          input: { accountId: "a", dateFrom: "2026-05-01", dateTo: "2026-05-31" },
        },
        { type: "tool_result", tool: "summarize_account", ok: true },
        { type: "answer", text: "Your May net was +$2,504.02." },
        { type: "done", stopReason: "ok", meta: { model: "claude-haiku-4-5", turns: 2 } },
      ]),
    );
    render(<Chat accountId="a" />);
    ask("What was my May net?");

    expect(await screen.findByText("Your May net was +$2,504.02.")).toBeInTheDocument();
    expect(screen.getByText("What was my May net?")).toBeInTheDocument(); // user message
    expect(screen.getByText("summarize_account")).toBeInTheDocument(); // tool trail
    expect(screen.getByText("2026-05-01 → 2026-05-31")).toBeInTheDocument(); // inputs (no figures)
    expect(screen.getByText(/claude-haiku-4-5/)).toBeInTheDocument(); // footer
  });

  it("shows a subtle note when the agent stopped at the step limit", async () => {
    vi.mocked(streamAgent).mockReturnValue(
      gen([
        { type: "answer", text: "I couldn't complete this within the step limit." },
        { type: "done", stopReason: "step_limit", meta: { model: "m", turns: 8 } },
      ]),
    );
    render(<Chat accountId="a" />);
    ask("loop forever");

    expect(
      await screen.findByText("I couldn't complete this within the step limit."),
    ).toBeInTheDocument();
    expect(screen.getByText(/stopped at the step limit/)).toBeInTheDocument();
  });

  it("shows an error with a retry, and retry re-streams a fresh answer", async () => {
    vi.mocked(streamAgent)
      .mockReturnValueOnce(
        gen([{ type: "error", code: "agent_error", message: "the request failed" }]),
      )
      .mockReturnValueOnce(
        gen([
          { type: "answer", text: "recovered answer" },
          { type: "done", stopReason: "ok", meta: { model: "m", turns: 1 } },
        ]),
      );
    render(<Chat accountId="a" />);
    ask("hi");

    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    expect(await screen.findByText("recovered answer")).toBeInTheDocument();
  });

  it("collapses the tool trail", async () => {
    vi.mocked(streamAgent).mockReturnValue(
      gen([
        { type: "tool_call", tool: "get_account", input: {} },
        { type: "tool_result", tool: "get_account", ok: true },
        { type: "answer", text: "ok" },
        { type: "done", stopReason: "ok", meta: { model: "m", turns: 1 } },
      ]),
    );
    render(<Chat accountId="a" />);
    ask("info");

    await screen.findByText("ok");
    expect(screen.getByText("get_account")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/tool call/));
    expect(screen.queryByText("get_account")).not.toBeInTheDocument();
  });
});
