"use client";

import { useState } from "react";
import { type ApiError, categorizeAccount, toApiError } from "../lib/api";
import type { CategorizeResponse } from "../lib/contracts";
import { ApiErrorBanner } from "./ApiErrorBanner";
import { Button } from "./Button";

type State =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: CategorizeResponse }
  | { status: "error"; error: ApiError };

function describeResult(r: CategorizeResponse): string {
  if (r.totalUncategorized === 0) {
    return "Everything is already categorized.";
  }
  const parts = [`${r.categorized} categorized`];
  if (r.uncategorized > 0) {
    parts.push(`${r.uncategorized} left uncategorized`);
  }
  if (r.failed > 0) {
    parts.push(`${r.failed} failed`);
  }
  return `${parts.join(" · ")} of ${r.totalUncategorized} pending.`;
}

export function CategorizeButton({
  accountId,
  onCategorized,
}: {
  accountId: string;
  onCategorized: () => void;
}) {
  const [state, setState] = useState<State>({ status: "idle" });

  function run() {
    setState({ status: "running" });
    categorizeAccount(accountId)
      .then((result) => {
        setState({ status: "done", result });
        onCategorized();
      })
      .catch((err: unknown) => setState({ status: "error", error: toApiError(err) }));
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="ghost" onClick={run} disabled={state.status === "running"}>
        {state.status === "running" ? "Categorizing…" : "Categorize uncategorized"}
      </Button>
      {state.status === "done" ? (
        <span className="text-sm text-zinc-600">{describeResult(state.result)}</span>
      ) : null}
      {state.status === "error" ? (
        <ApiErrorBanner
          error={state.error}
          fallbackTitle="Couldn't categorize"
          className="w-full"
        />
      ) : null}
    </div>
  );
}
