import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";

/** Lean table primitives (used by the Chunk C transactions view). */
export function Table({ className, ...props }: ComponentPropsWithoutRef<"table">) {
  return <table className={cn("w-full border-collapse text-left text-sm", className)} {...props} />;
}

export function Th({ className, ...props }: ComponentPropsWithoutRef<"th">) {
  return (
    <th
      className={cn(
        "border-b border-zinc-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentPropsWithoutRef<"td">) {
  return <td className={cn("border-b border-zinc-100 px-3 py-2", className)} {...props} />;
}
