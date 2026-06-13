"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { type ToolRow, type TurnState, initialTurn, turnReducer } from "../lib/chat-turn";
import { streamAgent } from "../lib/sse";
import { toolInputSummary } from "../lib/tool-summary";
import { Button } from "./Button";
import { Card } from "./Card";
import { ErrorBanner } from "./ErrorBanner";
import { Spinner } from "./Spinner";

type ChatMessage =
  | { readonly role: "user"; readonly id: string; readonly text: string }
  | { readonly role: "assistant"; readonly id: string; readonly question: string; turn: TurnState };

/**
 * Account chat. Each turn is an INDEPENDENT `/ask/stream` call (the API is
 * single-turn — no prior history is sent); the conversation lives only in client
 * state. Tool-call rows render live as they arrive (the answer lands after, per the
 * ADR-0010 gate), then a muted model/turns footer. The in-flight fetch is aborted on
 * unmount / new question, pairing with the server's disconnect cancellation.
 */
export function Chat({ accountId }: { accountId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  const setTurn = useCallback((asstId: string, update: (turn: TurnState) => TurnState) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.role === "assistant" && m.id === asstId ? { ...m, turn: update(m.turn) } : m,
      ),
    );
  }, []);

  const runStream = useCallback(
    async (asstId: string, question: string) => {
      setTurn(asstId, () => initialTurn);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      try {
        for await (const event of streamAgent(accountId, question, controller.signal)) {
          setTurn(asstId, (turn) => turnReducer(turn, event));
        }
      } catch {
        if (!controller.signal.aborted) {
          setTurn(asstId, (turn) =>
            turnReducer(turn, {
              type: "error",
              code: "agent_error",
              message: "the request failed",
            }),
          );
        }
      } finally {
        // `busy` belongs to the CURRENT stream only: if a new question/Retry
        // superseded this controller, or the component unmounted (signal aborted),
        // don't clear it out from under the successor.
        if (abortRef.current === controller && !controller.signal.aborted) {
          setBusy(false);
        }
      }
    },
    [accountId, setTurn],
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (question === "" || busy) {
      return;
    }
    const userId = `u${idRef.current++}`;
    const asstId = `a${idRef.current++}`;
    setMessages((prev) => [
      ...prev,
      { role: "user", id: userId, text: question },
      { role: "assistant", id: asstId, question, turn: initialTurn },
    ]);
    setInput("");
    void runStream(asstId, question);
  }

  return (
    <div className="space-y-4">
      {messages.length > 0 ? (
        <ul className="space-y-4">
          {messages.map((m) =>
            m.role === "user" ? (
              <li key={m.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl bg-emerald-600 px-4 py-2 text-sm text-white">
                  {m.text}
                </div>
              </li>
            ) : (
              <li key={m.id}>
                <AssistantTurn
                  turn={m.turn}
                  busy={busy}
                  onRetry={() => void runStream(m.id, m.question)}
                />
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">
          Ask a natural-language question about this account — figures come straight from the tools;
          the agent never does the math.
        </p>
      )}

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about this account…"
          aria-label="Ask a question"
          disabled={busy}
          className="flex-1 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-60"
        />
        <Button type="submit" disabled={busy || input.trim() === ""}>
          {busy ? "Asking…" : "Ask"}
        </Button>
      </form>
    </div>
  );
}

function AssistantTurn({
  turn,
  busy,
  onRetry,
}: { turn: TurnState; busy: boolean; onRetry: () => void }) {
  const [open, setOpen] = useState(true);
  const pending = turn.answer === null && turn.error === null && !turn.done;

  return (
    <Card className="space-y-3 px-5 py-4">
      {turn.tools.length > 0 ? (
        <div className="text-sm">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-xs font-medium uppercase tracking-wide text-zinc-400 transition-colors hover:text-zinc-600"
          >
            {turn.tools.length} tool {turn.tools.length === 1 ? "call" : "calls"} {open ? "▾" : "▸"}
          </button>
          {open ? (
            <ul className="mt-2 space-y-1">
              {turn.tools.map((row) => (
                <li key={row.id} className="flex items-center gap-2 text-zinc-600">
                  <ToolStatus status={row.status} />
                  <span className="font-mono text-xs">{row.tool}</span>
                  {toolInputSummary(row.input) !== "" ? (
                    <span className="text-xs text-zinc-400">{toolInputSummary(row.input)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {turn.answer !== null ? (
        <p className="whitespace-pre-wrap text-sm text-zinc-800">{turn.answer}</p>
      ) : null}

      {pending ? (
        <span className="flex items-center gap-2 text-sm text-zinc-400">
          <Spinner /> Working…
        </span>
      ) : null}

      {turn.error !== null ? (
        <ErrorBanner title="The agent couldn't complete this request">
          <Button variant="ghost" onClick={onRetry} disabled={busy} className="mt-2">
            Retry
          </Button>
        </ErrorBanner>
      ) : null}

      {turn.done && turn.error === null && turn.meta !== null ? (
        <p className="text-xs text-zinc-400">
          {turn.meta.model} · {turn.meta.turns} {turn.meta.turns === 1 ? "turn" : "turns"}
          {turn.stopReason === "step_limit" ? " · stopped at the step limit" : ""}
        </p>
      ) : null}
    </Card>
  );
}

function ToolStatus({ status }: { status: ToolRow["status"] }) {
  if (status === "running") {
    return <Spinner className="h-3 w-3" />;
  }
  return (
    <span aria-hidden className={status === "ok" ? "text-emerald-600" : "text-rose-600"}>
      {status === "ok" ? "✓" : "✗"}
    </span>
  );
}
