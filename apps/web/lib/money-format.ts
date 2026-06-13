/**
 * Pure money-display logic, kept out of the component so the determinism rule is
 * unit-testable without rendering. Determinism-first (spec 0006): the exact decimal
 * comes ONLY from the shared `moneyDtoToDecimalString` — never `Number()`/`÷100`.
 * Sign + colour are derived from `direction` (debit = out → `-`/rose, credit = in →
 * `+`/emerald); the magnitude itself is always non-negative.
 */
import { type Direction, type MoneyDTO, moneyDtoToDecimalString } from "@ledger-lens/shared";

export interface MoneyDisplay {
  readonly text: string;
  readonly tone: string;
}

/** Single source for the in/out colour: debit (out) = rose, credit (in) = emerald. */
export function directionTone(direction: Direction): string {
  return direction === "debit" ? "text-rose-600" : "text-emerald-600";
}

export function moneyDisplay(amount: MoneyDTO, direction: Direction): MoneyDisplay {
  const decimal = moneyDtoToDecimalString(amount);
  const sign = direction === "debit" ? "-" : "+";
  return { text: `${sign}${amount.currency} ${decimal}`, tone: directionTone(direction) };
}
