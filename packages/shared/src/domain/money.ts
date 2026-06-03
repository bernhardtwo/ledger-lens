/**
 * Money value object (see ADR-0005).
 *
 * Money is an exact, currency-aware, **non-negative magnitude** held as integer
 * minor units in `bigint` — never a float. Direction (debit/credit) lives on the
 * transaction, so a `Money` carries no sign. All arithmetic is same-currency
 * only and throws on mismatch; there is no implicit FX. This module is the only
 * place money math happens, and it is fully deterministic (ADR-0004).
 */
import { z } from "zod";
import { type CurrencyCode, CurrencyCodeSchema, minorUnitExponentOf } from "./currency.js";

/** A non-negative amount of money in a single currency. `amount` is minor units. */
export interface Money {
  /** Magnitude in minor units (e.g. cents); always `>= 0n`. */
  readonly amount: bigint;
  /** ISO-4217 currency code. */
  readonly currency: CurrencyCode;
  /** Minor-unit exponent, derived from the ISO-4217 registry. */
  readonly minorUnitExponent: number;
}

/** Raised by any invalid money operation (mismatch, underflow, bad input). */
export class MoneyError extends Error {
  override readonly name = "MoneyError";
}

/**
 * JSON-safe boundary shape for `Money` (API in/out, LLM structured output).
 * `amount` is a decimal-free string of minor units because `bigint` is not valid
 * JSON and `number` would lose precision. The exponent is cross-checked against
 * the ISO-4217 registry so a DTO can never disagree with its own currency.
 */
export const MoneySchema = z
  .object({
    amount: z.string().regex(/^\d+$/, "amount must be non-negative minor units"),
    currency: CurrencyCodeSchema,
    // Exact value is pinned against the registry in superRefine below; here we
    // only require a non-negative integer (no magic upper bound to drift).
    minorUnitExponent: z.number().int().nonnegative(),
  })
  .superRefine((dto, ctx) => {
    const expected = minorUnitExponentOf(dto.currency);
    if (dto.minorUnitExponent !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minorUnitExponent"],
        message: `minorUnitExponent ${dto.minorUnitExponent} != ISO-4217 exponent ${expected} for ${dto.currency}`,
      });
    }
  });

/** The serialized form of `Money` (see `MoneySchema`). */
export type MoneyDTO = z.infer<typeof MoneySchema>;

/**
 * Construct `Money` from raw minor units. Throws if `amount` is negative — money
 * is a magnitude, and sign belongs to the transaction's direction.
 */
export function money(amount: bigint, currency: CurrencyCode): Money {
  if (amount < 0n) {
    throw new MoneyError(`amount must be non-negative, got ${amount}`);
  }
  return { amount, currency, minorUnitExponent: minorUnitExponentOf(currency) };
}

/** Zero in the given currency. */
export function zeroMoney(currency: CurrencyCode): Money {
  return money(0n, currency);
}

/**
 * Parse a human decimal string ("1234.56") into `Money`, exactly. No rounding:
 * more fractional digits than the currency's exponent is an error, never a
 * silent truncation. Sign, thousands separators and currency symbols are the
 * caller's responsibility — input must match `\d+(\.\d+)?`.
 */
export function fromDecimalString(value: string, currency: CurrencyCode): Money {
  // Canonical integer part only: a lone "0" or a non-zero-led run. Rejecting
  // leading zeros ("007.50") keeps parsing a strict inverse of toDecimalString
  // for canonical inputs instead of silently normalizing them.
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value.trim());
  const [, intPart, fracPart = ""] = match ?? [];
  if (intPart === undefined) {
    throw new MoneyError(`not a non-negative decimal amount: "${value}"`);
  }
  const exponent = minorUnitExponentOf(currency);
  if (fracPart.length > exponent) {
    throw new MoneyError(
      `"${value}" has more fractional digits than ${currency} allows (${exponent})`,
    );
  }
  const minor = `${intPart}${fracPart.padEnd(exponent, "0")}`;
  return money(BigInt(minor), currency);
}

/**
 * Render `Money` as a canonical decimal string with exactly `exponent`
 * fractional digits (no grouping, no symbol). Inverse of `fromDecimalString` for
 * canonical inputs. Display formatting (locale, symbol) is a presentation edge.
 */
export function toDecimalString(value: Money): string {
  const digits = value.amount.toString();
  const { minorUnitExponent: exponent } = value;
  if (exponent === 0) {
    return digits;
  }
  const padded = digits.padStart(exponent + 1, "0");
  const cut = padded.length - exponent;
  return `${padded.slice(0, cut)}.${padded.slice(cut)}`;
}

/** Serialize `Money` to its JSON-safe DTO. */
export function toMoneyDTO(value: Money): MoneyDTO {
  return {
    amount: value.amount.toString(),
    currency: value.currency,
    minorUnitExponent: value.minorUnitExponent,
  };
}

/** Validate and deserialize an unknown input into `Money` at a trust boundary. */
export function parseMoney(input: unknown): Money {
  const dto = MoneySchema.parse(input);
  // dto.minorUnitExponent was validated as a cross-check; the registry is the
  // source of truth, so money() re-derives it rather than trusting the wire.
  return money(BigInt(dto.amount), dto.currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`currency mismatch: ${a.currency} vs ${b.currency} — no implicit FX`);
  }
}

/** Add two same-currency amounts. Throws on currency mismatch. */
export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

/**
 * Subtract `b` from `a` (same currency). Throws on mismatch, and on underflow:
 * money is non-negative, so a result below zero is a caller error — compare
 * first and attach a direction rather than expecting negative money.
 */
export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  const diff = a.amount - b.amount;
  if (diff < 0n) {
    throw new MoneyError(`subtract underflow: ${toDecimalString(a)} - ${toDecimalString(b)} < 0`);
  }
  return money(diff, a.currency);
}

/** Three-way compare same-currency amounts: -1 | 0 | 1. Throws on mismatch. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amount < b.amount) {
    return -1;
  }
  return a.amount > b.amount ? 1 : 0;
}

/** Is this amount exactly zero? */
export function isZeroMoney(value: Money): boolean {
  return value.amount === 0n;
}
