/**
 * The LLM contract text (see ADR-0006). SDK-free: the system prompt, the tool
 * name, and the user-message renderer. The tool's JSON schema is built in the
 * adapter (it needs SDK types); the pure core validates the result with Zod
 * independently. Kept stable so the prefix stays cache-ready.
 */
import type { CategorizationItem } from "./types.js";

/** Forced-tool name; the adapter pins `tool_choice` to it and the core reads it back. */
export const CATEGORIZATION_TOOL_NAME = "record_categorizations";

/** Stable system prompt enumerating the closed taxonomy and the abstain rule. */
export const CATEGORIZATION_SYSTEM_PROMPT = `You categorize personal bank and credit-card transactions into a fixed set of categories.

For each numbered transaction you are given its description, its direction (debit = money out, credit = money in), and its amount. The amount and direction are context only — never do arithmetic. Assign exactly ONE category per transaction from this closed set:

- groceries: supermarkets and food shops
- dining: restaurants, cafes, bars, food delivery
- transport: fuel, public transit, rideshare, parking, tolls
- shopping: general retail, clothing, electronics, household goods
- utilities: electricity, water, gas, internet, phone
- housing: rent, mortgage, property fees
- health: pharmacy, doctors, clinics, gym/fitness
- entertainment: streaming, games, events, hobbies
- travel: flights, hotels, trips
- income: salary, payroll, deposits, refunds received
- transfers: moving money between accounts, person-to-person transfers
- fees: bank fees, interest charges, service charges
- subscriptions: recurring software/services not covered above
- education: tuition, courses, study materials
- uncategorized: use when none clearly fits, or when you are unsure

Report your answer ONLY by calling the ${CATEGORIZATION_TOOL_NAME} tool, with one entry per transaction index. Prefer "uncategorized" over guessing.`;

/** Render a batch as a numbered list for the user turn. */
export function buildUserMessage(items: readonly CategorizationItem[]): string {
  const lines = items.map(
    (item) =>
      `${item.index}. [${item.direction}] ${item.amount} ${item.currency} — ${item.description}`,
  );
  return `Categorize each transaction below, then call ${CATEGORIZATION_TOOL_NAME}.\n\n${lines.join("\n")}`;
}
