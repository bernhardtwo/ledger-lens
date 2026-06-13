/**
 * Money renderer. Determinism-first at the presentation boundary (spec 0006): all
 * formatting lives in the pure `moneyDisplay` (tested separately); this component
 * only renders its output. `direction` is required — a money figure on a line is
 * always a debit or a credit (no unsigned third state).
 */
import type { Direction, MoneyDTO } from "@ledger-lens/shared";
import { cn } from "./cn";
import { moneyDisplay } from "./money-format";

export function Money({
  amount,
  direction,
  className,
}: {
  amount: MoneyDTO;
  direction: Direction;
  className?: string;
}) {
  const { text, tone } = moneyDisplay(amount, direction);
  return <span className={cn("font-mono tabular-nums", tone, className)}>{text}</span>;
}
