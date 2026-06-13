"use client";

import { useEffect, useState } from "react";
import { ApiError, listAccounts } from "../lib/api";
import type { Account } from "../lib/contracts";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { ErrorBanner } from "./ErrorBanner";
import { Spinner } from "./Spinner";

type State =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; accounts: Account[] };

/**
 * The no-auth demo picker. Fetches `GET /accounts` from the browser via the
 * same-origin `/api` proxy and renders the seed accounts from real API data +
 * shared types — the end-to-end proof that the proxy, the shared import, and the
 * transpile all work. (Selecting an account opens the workspace in Chunk C.)
 */
export function AccountPicker() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;
    listAccounts()
      .then((accounts) => {
        if (active) {
          setState({ status: "ready", accounts });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            error: error instanceof ApiError ? error : new ApiError(0, "Unexpected error"),
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Spinner /> Loading accounts…
      </div>
    );
  }

  if (state.status === "error") {
    const unreachable = state.error.status === 0;
    return (
      <ErrorBanner
        title={unreachable ? "API unreachable" : `Couldn't load accounts (${state.error.status})`}
      >
        {unreachable ? "Is the API running on the configured API_BASE_URL?" : state.error.message}
      </ErrorBanner>
    );
  }

  if (state.accounts.length === 0) {
    return <p className="text-sm text-zinc-500">No accounts found.</p>;
  }

  return (
    <ul className="space-y-3">
      {state.accounts.map((account) => (
        <li key={account.id}>
          <Card className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="truncate font-medium text-zinc-900">{account.name}</p>
              <p className="truncate text-sm text-zinc-500">{account.institution}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Badge tone="neutral">{account.currency}</Badge>
              <Button variant="ghost" disabled title="Opens in Chunk C">
                Open
              </Button>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
