import type { ReactNode } from "react";
import { Card } from "./Card";
import { Spinner } from "./Spinner";

/** Consistent in-flight line (spinner + muted label) shared by data-loading surfaces. */
export function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-500">
      <Spinner /> {label}
    </div>
  );
}

/** Consistent friendly empty state — a centered, muted card. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <Card className="px-5 py-10 text-center text-sm text-zinc-500">{children}</Card>;
}
