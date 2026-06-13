"use client";

import { type FormEvent, useRef, useState } from "react";
import { type ApiError, toApiError, uploadStatement } from "../lib/api";
import type { StatementIngestResponse } from "../lib/contracts";
import { Button } from "./Button";
import { Card } from "./Card";
import { ErrorBanner } from "./ErrorBanner";

type State =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "done"; result: StatementIngestResponse }
  | { status: "error"; error: ApiError };

/** Map the API's real error codes to a user-facing message (see spec 0006 §5). */
function describeError(error: ApiError): { title: string; detail: string } {
  if (error.status === 413) {
    return { title: "File too large", detail: "Statements must be 5 MB or smaller." };
  }
  if (error.status === 415) {
    return { title: "Unsupported file", detail: "Only CSV files are accepted." };
  }
  if (error.status === 422 && error.code === "unknown-profile") {
    return {
      title: "Unrecognized CSV format",
      detail: error.signature ? `Couldn't match these columns: ${error.signature}` : error.message,
    };
  }
  if (error.status === 422) {
    // currency-mismatch / too-many-rejected — the API message is already specific.
    return { title: "Couldn't process the file", detail: error.message };
  }
  if (error.status === 0) {
    return { title: "API unreachable", detail: "Is the API running?" };
  }
  return { title: "Upload failed", detail: error.message };
}

export function UploadPanel({
  accountId,
  onUploaded,
}: {
  accountId: string;
  onUploaded: () => void;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (file === undefined) {
      return;
    }
    setState({ status: "uploading" });
    uploadStatement(accountId, file)
      .then((result) => {
        setState({ status: "done", result });
        onUploaded();
      })
      .catch((err: unknown) => setState({ status: "error", error: toApiError(err) }));
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV statement"
          className="block text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border file:border-zinc-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-50"
        />
        <Button type="submit" disabled={state.status === "uploading"}>
          {state.status === "uploading" ? "Uploading…" : "Upload CSV"}
        </Button>
      </form>

      {state.status === "done" ? <UploadResult result={state.result} /> : null}
      {state.status === "error" ? <UploadError error={state.error} /> : null}
    </div>
  );
}

function UploadError({ error }: { error: ApiError }) {
  const { title, detail } = describeError(error);
  return <ErrorBanner title={title}>{detail}</ErrorBanner>;
}

function UploadResult({ result }: { result: StatementIngestResponse }) {
  const created = result.statementId !== null;
  return (
    <Card className="px-4 py-3 text-sm">
      <p className="font-medium text-emerald-700">
        {created ? "Statement imported" : "Already imported — no new rows"}
      </p>
      <p className="mt-0.5 text-zinc-600">
        {result.inserted} inserted · {result.skipped} skipped (duplicates)
        {result.rejected.length > 0 ? ` · ${result.rejected.length} rejected` : ""}
      </p>
      {result.rejected.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-zinc-500">
            Rejected rows ({result.rejected.length})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {result.rejected.map((r) => (
              <li key={r.row} className="text-rose-700">
                Row {r.row}: {r.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
