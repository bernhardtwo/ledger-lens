/**
 * ISO-4217 currency registry (see ADR-0005).
 *
 * The registry is the single source of truth for each currency's minor-unit
 * exponent, so the rest of the system never hard-codes "money has 2 decimals".
 * Currencies the project handles must be listed here; an unknown code fails Zod
 * validation rather than being guessed — keeping money handling deterministic.
 */
import { z } from "zod";

/**
 * Supported ISO-4217 codes. Deliberately a small, explicit set (the synthetic
 * data spans these) covering exponents 0, 2 and 3 so the exponent logic is real
 * and tested, not assumed. Add a code here when a new statement currency lands.
 */
export const CURRENCY_CODES = ["USD", "EUR", "GBP", "MXN", "COP", "JPY", "BHD"] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** Zod boundary schema for a currency code (API in/out, LLM structured output). */
export const CurrencyCodeSchema = z.enum(CURRENCY_CODES);

/**
 * ISO-4217 minor-unit exponent per currency: the number of decimal places.
 * e.g. USD 1.00 -> exponent 2 (cents); JPY has no minor unit -> 0; BHD -> 3.
 */
const MINOR_UNIT_EXPONENTS: Record<CurrencyCode, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  MXN: 2,
  COP: 2,
  JPY: 0,
  BHD: 3,
};

/** The minor-unit exponent for a known currency. Total over `CurrencyCode`. */
export function minorUnitExponentOf(currency: CurrencyCode): number {
  return MINOR_UNIT_EXPONENTS[currency];
}

/** Type guard: is an arbitrary string a currency code the project supports? */
export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(MINOR_UNIT_EXPONENTS, value);
}
