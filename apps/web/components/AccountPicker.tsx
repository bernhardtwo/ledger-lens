"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type ApiError, listAccounts, toApiError } from "../lib/api";
import type { Account } from "../lib/contracts";
import { ApiErrorBanner } from "./ApiErrorBanner";
import { Badge } from "./Badge";
import { buttonClassName } from "./Button";
import { Card } from "./Card";
import { EmptyState, Loading } from "./States";

type State =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; accounts: Account[] };

/**
 * The no-auth demo picker. Fetches `GET /accounts` from the browser via the
 * same-origin `/api` proxy and links each seed account to its workspace.
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
          setState({ status: "error", error: toApiError(error) });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loading") {
    return <Loading label="Loading accounts…" />;
  }

  if (state.status === "error") {
    return <ApiErrorBanner error={state.error} fallbackTitle="Couldn't load accounts" />;
  }

  if (state.accounts.length === 0) {
    return <EmptyState>No demo accounts found.</EmptyState>;
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
              <Link href={`/accounts/${account.id}`} className={buttonClassName("ghost")}>
                Open →
              </Link>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
