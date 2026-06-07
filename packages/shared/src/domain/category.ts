/**
 * Transaction category taxonomy (see ADR-0006, spec 0002).
 *
 * A **closed** set: the single source of truth for both the LLM contract (the
 * model may only return one of these slugs) and persistence validation. `uncategorized`
 * is the explicit fallback used when the model abstains or returns anything off-set.
 *
 * Deliberately lean — a small closed taxonomy classifies more reliably and is
 * easier to evaluate. (`cash`/ATM is intentionally absent: the synthetic
 * statements contain no ATM activity.)
 */
import { z } from "zod";

/** The closed category set. Order is not significant. */
export const CATEGORIES = [
  "groceries",
  "dining",
  "transport",
  "shopping",
  "utilities",
  "housing",
  "health",
  "entertainment",
  "travel",
  "income",
  "transfers",
  "fees",
  "subscriptions",
  "education",
  "uncategorized",
] as const;

/** Zod enum over the closed taxonomy (LLM tool schema + persistence boundary). */
export const CategorySchema = z.enum(CATEGORIES);

/** A validated category slug. */
export type Category = z.infer<typeof CategorySchema>;

/** The fallback assigned when the model abstains or returns an off-taxonomy value. */
export const UNCATEGORIZED = "uncategorized" as const satisfies Category;
