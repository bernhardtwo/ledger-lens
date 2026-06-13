/** Minimal class-name joiner (no clsx/tailwind-merge dependency). */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
