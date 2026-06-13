"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { listAccounts } from "../lib/api";
import type { Account } from "../lib/contracts";
import { Badge } from "./Badge";
import { CategorizeButton } from "./CategorizeButton";
import { Chat } from "./Chat";
import { TransactionsTable } from "./TransactionsTable";
import { UploadPanel } from "./UploadPanel";

const SECTION_HEADING = "mb-3 text-xs font-medium uppercase tracking-wide text-zinc-400";

/**
 * The per-account workspace: import a statement, categorize, and browse the keyset
 * transactions list. A `refreshNonce` bumps after upload/categorize so the table
 * re-fetches its first page (and the new/updated rows show).
 */
export function AccountWorkspace({ accountId }: { accountId: string }) {
  const [nonce, setNonce] = useState(0);
  const [account, setAccount] = useState<Account | null>(null);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    listAccounts()
      .then((accounts) => {
        if (active) {
          setAccount(accounts.find((a) => a.id === accountId) ?? null);
        }
      })
      .catch(() => {
        /* header name is best-effort; the surfaces below report their own errors */
      });
    return () => {
      active = false;
    };
  }, [accountId]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href="/"
        className="rounded text-sm text-zinc-500 transition-colors hover:text-zinc-800 focus-visible:text-zinc-800 focus-visible:underline focus-visible:outline-none"
      >
        ← Accounts
      </Link>
      <header className="mt-3 mb-10 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          {account ? account.name : "Account"}
        </h1>
        {account ? <Badge tone="neutral">{account.currency}</Badge> : null}
      </header>

      <div className="space-y-10">
        <section aria-label="Ask">
          <h2 className={SECTION_HEADING}>Ask</h2>
          <Chat key={accountId} accountId={accountId} />
        </section>

        <section aria-label="Import a statement">
          <h2 className={SECTION_HEADING}>Import a statement</h2>
          <UploadPanel accountId={accountId} onUploaded={refresh} />
        </section>

        <section aria-label="Categorize">
          <h2 className={SECTION_HEADING}>Categorize</h2>
          <CategorizeButton accountId={accountId} onCategorized={refresh} />
        </section>

        <section aria-label="Transactions">
          <h2 className={SECTION_HEADING}>Transactions</h2>
          <TransactionsTable key={`${accountId}:${nonce}`} accountId={accountId} />
        </section>
      </div>
    </main>
  );
}
