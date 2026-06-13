import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export function ErrorBanner({
  title,
  children,
  className,
}: {
  title: string;
  children?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800",
        className,
      )}
    >
      <p className="font-medium">{title}</p>
      {children ? <p className="mt-1 text-rose-700">{children}</p> : null}
    </div>
  );
}
