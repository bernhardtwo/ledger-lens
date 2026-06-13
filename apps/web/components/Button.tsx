import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../lib/cn";

type Variant = "primary" | "ghost";

const BASE =
  "inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-emerald-600 text-white hover:bg-emerald-500",
  ghost: "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
};

/** The shared button look, also usable on a non-button (e.g. a Next `<Link>`). */
export function buttonClassName(variant: Variant = "primary", className?: string): string {
  return cn(BASE, VARIANTS[variant], className);
}

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: Variant;
};

export function Button({ variant = "primary", className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClassName(variant, className)} {...props} />;
}
