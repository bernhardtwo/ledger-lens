"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type ApiError, listTransactions, toApiError } from "../lib/api";
import type { TransactionListItemResponse } from "../lib/contracts";
import { Money } from "../lib/money";
import { directionTone } from "../lib/money-format";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { ErrorBanner } from "./ErrorBanner";
import { Spinner } from "./Spinner";
import { Table, Td, Th } from "./Table";

type Status = "loading" | "ready" | "loading-more" | "error";

/**
 * Keyset, forward-only transactions list. "Load more" appends using `nextCursor`
 * and stops when it is `null` (no numbered pages). The parent remounts this (via a
 * `key` of `accountId` + a refresh nonce) so it resets and refetches after an upload
 * or a categorize run. Money renders only via `<Money>` (shared helper) — never recomputed.
 */
export function TransactionsTable({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<TransactionListItemResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<ApiError | null>(null);
  // Generation counter so only the latest "Load more" result is applied (guards
  // against rapid re-entry appending the same page twice / out of order).
  const reqId = useRef(0);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setRows([]);
    setCursor(null);
    setError(null);
    listTransactions(accountId)
      .then((page) => {
        if (active) {
          setRows(page.items);
          setCursor(page.nextCursor);
          setStatus("ready");
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(toApiError(e));
          setStatus("error");
        }
      });
    return () => {
      active = false;
    };
  }, [accountId]);

  const loadMore = useCallback(() => {
    if (cursor === null || status === "loading-more") {
      return;
    }
    const mine = ++reqId.current;
    setStatus("loading-more");
    listTransactions(accountId, cursor)
      .then((page) => {
        if (mine !== reqId.current) {
          return; // a newer request superseded this one
        }
        setRows((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (mine !== reqId.current) {
          return;
        }
        setError(toApiError(e));
        setStatus("error");
      });
  }, [accountId, cursor, status]);

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Spinner /> Loading transactions…
      </div>
    );
  }

  if (status === "error" && rows.length === 0) {
    return <ErrorBanner title="Couldn't load transactions">{error?.message}</ErrorBanner>;
  }

  if (rows.length === 0) {
    return (
      <Card className="px-5 py-10 text-center text-sm text-zinc-500">
        No transactions yet. Upload a CSV statement to get started.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <Table>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Description</Th>
            <Th>Category</Th>
            <Th>Direction</Th>
            <Th className="text-right">Amount</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-zinc-50">
              <Td>
                <div className="font-medium text-zinc-900">{row.transactionDate}</div>
                {row.postedDate ? (
                  <div className="text-xs text-zinc-400">posted {row.postedDate}</div>
                ) : null}
              </Td>
              <Td className="text-zinc-700">{row.description}</Td>
              <Td>
                {row.category ? (
                  <Badge tone="neutral">{row.category}</Badge>
                ) : (
                  <Badge tone="warning">Uncategorized</Badge>
                )}
              </Td>
              <Td>
                <span className={directionTone(row.direction)}>
                  {row.direction === "credit" ? "in" : "out"}
                </span>
              </Td>
              <Td className="text-right">
                <Money amount={row.amount} direction={row.direction} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3">
        <span className="text-xs text-zinc-400">{rows.length} shown</span>
        <div className="flex items-center gap-3">
          {status === "error" ? (
            <span className="text-xs text-rose-600">{error?.message ?? "Couldn't load more."}</span>
          ) : null}
          {cursor !== null ? (
            <Button variant="ghost" onClick={loadMore} disabled={status === "loading-more"}>
              {status === "loading-more" ? "Loading…" : "Load more"}
            </Button>
          ) : (
            <span className="text-xs text-zinc-400">End of list</span>
          )}
        </div>
      </div>
    </Card>
  );
}
