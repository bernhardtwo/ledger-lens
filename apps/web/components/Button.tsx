import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "ghost";
};

export function Button({ variant = "primary", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary"
          ? "bg-emerald-600 text-white hover:bg-emerald-500"
          : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
        className,
      )}
      {...props}
    />
  );
}
