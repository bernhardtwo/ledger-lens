/**
 * Deterministic money-token matching (see spec 0005) — the crux of the gating
 * figure metric and the reported faithfulness metric. Pure string logic,
 * exhaustively unit-tested. No LLM, no I/O.
 *
 * Two asymmetric needs:
 *  - **Figure (gating):** does the answer contain a *known* ground-truth amount?
 *    Inclusive — consider every numeric token so a correct answer that drops the
 *    "$"/decimals ("2000") still matches "2000.00". A coincidental false positive
 *    on a known target is unlikely and acceptable.
 *  - **Faithfulness (reported):** does the answer contain a *money* figure it
 *    shouldn't? Conservative — only count money-SHAPED tokens (currency-prefixed
 *    or carrying decimals), so bare integers (counts, years, day numbers) are not
 *    mistaken for fabricated money. This keeps the (eventually gating) metric from
 *    flaking on a real-API run.
 */
import { type MoneyDTO, money, toDecimalString } from "@ledger-lens/shared";

/** Render a `MoneyDTO` as its canonical decimal string (e.g. `"2495.98"`). */
export function renderDecimal(dto: MoneyDTO): string {
  return toDecimalString(money(BigInt(dto.amount), dto.currency));
}

/**
 * Reduce a raw numeric/money token to a canonical numeric string: drop currency
 * symbols, thousands separators and spaces; drop an all-/trailing-zero fraction
 * and a dangling dot; strip leading zeros. So `"$2,000.00"`, `"2000"` and
 * `"2,000.0"` all canonicalize to `"2000"`, while `"2495.98"` stays `"2495.98"`.
 */
export function canonicalAmount(raw: string): string {
  let s = raw.replace(/[^0-9.]/g, "");
  if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  s = s.replace(/^0+(?=\d)/, "");
  return s === "" || s === "." ? "0" : s;
}

/** Every numeric run in the text (with optional grouping/decimals), verbatim. */
export function extractNumericTokens(text: string): string[] {
  return text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
}

// A money-shaped token: either currency-prefixed (`$`/`€`, optional space) OR
// carrying a decimal point. Two alternatives so a bare integer is never money.
const MONEY_TOKEN_RE = /[$€]\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*\.\d+)/g;

/** The money-shaped tokens in the text (the numeric part only), verbatim. */
export function extractMoneyTokens(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(MONEY_TOKEN_RE)) {
    const token = match[1] ?? match[2];
    if (token === undefined) {
      continue;
    }
    // A number written as a percentage (`5.5%`) is a ratio, not money — don't let
    // it count as a fabricated figure. (Conservative, per ADR-0009 §2.)
    if (text[(match.index ?? 0) + match[0].length] === "%") {
      continue;
    }
    out.push(token);
  }
  return out;
}

/**
 * Does `answer` contain `decimal` as a standalone numeric value? Boundary-safe:
 * tokens are whole numeric runs, so `"12504.02"` does not match `"2504.02"` and
 * `"2504.029"` does not match `"2504.02"`.
 */
export function answerContainsAmount(answer: string, decimal: string): boolean {
  const target = canonicalAmount(decimal);
  return extractNumericTokens(answer).some((token) => canonicalAmount(token) === target);
}
