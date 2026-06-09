/**
 * The golden dataset (see spec 0005). A small, typed, Zod-validated set of cases:
 * `question → expected tool(s) + ground truth`. Ground truth is **committed**
 * (readable, reviewable) AND verified against the deterministic seed by a unit
 * test (`computeGroundTruth`), so it can never silently drift from the seed.
 *
 * Figures are stated in minor units as `MoneyDTO`s; they are the exact output of
 * the money folds over `DEMO_SEED` (verified by the consistency test in
 * `dataset.test.ts` via `computeGroundTruth`).
 */
import { SEED_ACCOUNTS } from "@ledger-lens/db";
import { CategorySchema, IsoDateSchema, MoneySchema, isoDate } from "@ledger-lens/shared";
import { z } from "zod";

/** The four account-scoped domain tools the agent may use (see ADR-0008). */
export const DOMAIN_TOOLS = [
  "get_account",
  "list_transactions",
  "summarize_spending_by_category",
  "summarize_account",
] as const;

const DomainToolSchema = z.enum(DOMAIN_TOOLS);
export type DomainTool = z.infer<typeof DomainToolSchema>;

/**
 * A tool expectation: a single tool that must be called, or a set of alternatives
 * of which at least one must be called (for questions either summarize tool can
 * answer — e.g. total spending via `summarize_account` or
 * `summarize_spending_by_category`).
 */
const ToolExpectationSchema = z.union([DomainToolSchema, z.array(DomainToolSchema).min(1)]);
export type ToolExpectation = z.infer<typeof ToolExpectationSchema>;

/** What a correct answer must carry. */
const GroundTruthSchema = z.discriminatedUnion("kind", [
  /** The answer must contain this exact figure. */
  z.object({ kind: z.literal("figure"), money: MoneySchema }),
  /** The answer must contain these substring(s) (e.g. the top category name). */
  z.object({ kind: z.literal("text"), contains: z.array(z.string().min(1)).min(1) }),
  /** The tools cannot answer: the agent must decline, fabricating no figure. */
  z.object({ kind: z.literal("refusal") }),
]);
export type GroundTruth = z.infer<typeof GroundTruthSchema>;

/** How a case's ground truth is computed from the seed (input to the consistency test). */
const DerivationSchema = z.object({
  metric: z.enum([
    "net",
    "totalIn",
    "totalOut",
    "categorySpend",
    "topCategoryAmount",
    "topCategoryName",
    "none",
  ]),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
  category: CategorySchema.optional(),
});
export type Derivation = z.infer<typeof DerivationSchema>;

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  accountId: z.string().uuid(),
  expectedTools: z.array(ToolExpectationSchema),
  groundTruth: GroundTruthSchema,
  derivation: DerivationSchema,
  notes: z.string().optional(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

const USD_ACCOUNT_ID = SEED_ACCOUNTS[0].id;
const EUR_ACCOUNT_ID = SEED_ACCOUNTS[1].id;
const MAY_FROM = isoDate("2026-05-01");
const MAY_TO = isoDate("2026-05-31");

const usd = (amount: string) => ({ amount, currency: "USD", minorUnitExponent: 2 }) as const;
const eur = (amount: string) => ({ amount, currency: "EUR", minorUnitExponent: 2 }) as const;

/**
 * The committed golden cases. ~13 across both accounts (currency coverage),
 * including two refusals that directly probe determinism/faithfulness (a figure
 * the tools don't expose, and an out-of-scope question).
 */
export const EVAL_CASES: readonly EvalCase[] = [
  {
    id: "usd-net-may",
    question: "What was my net cash flow in May 2026?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: ["summarize_account"],
    groundTruth: { kind: "figure", money: usd("250402") },
    derivation: { metric: "net", dateFrom: MAY_FROM, dateTo: MAY_TO },
    notes: "Net inflow 2504.02 = 5000.00 in - 2495.98 out (May only).",
  },
  {
    id: "usd-net-all",
    question: "What is my overall net cash flow across all time?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: ["summarize_account"],
    groundTruth: { kind: "figure", money: usd("750402") },
    derivation: { metric: "net" },
    notes: "All-time includes the April payroll, so it differs from the May net.",
  },
  {
    id: "usd-top-category-name",
    question: "Which spending category did I spend the most on in May 2026?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: ["summarize_spending_by_category"],
    groundTruth: { kind: "text", contains: ["housing"] },
    derivation: { metric: "topCategoryName", dateFrom: MAY_FROM, dateTo: MAY_TO },
  },
  {
    id: "usd-top-category-amount",
    question: "How much did I spend on my single biggest spending category in May 2026?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: ["summarize_spending_by_category"],
    groundTruth: { kind: "figure", money: usd("200000") },
    derivation: { metric: "topCategoryAmount", dateFrom: MAY_FROM, dateTo: MAY_TO },
    notes: "Housing = 2000.00.",
  },
  {
    id: "usd-groceries-may",
    question: "How much did I spend on groceries in May 2026?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: ["summarize_spending_by_category"],
    groundTruth: { kind: "figure", money: usd("20000") },
    derivation: {
      metric: "categorySpend",
      category: "groceries",
      dateFrom: MAY_FROM,
      dateTo: MAY_TO,
    },
    notes: "200.00 = 125.00 + 75.00.",
  },
  {
    id: "usd-dining-may",
    question: "How much did I spend on dining in May 2026?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: ["summarize_spending_by_category"],
    groundTruth: { kind: "figure", money: usd("3500") },
    derivation: { metric: "categorySpend", category: "dining", dateFrom: MAY_FROM, dateTo: MAY_TO },
    notes: "35.00 = 15.00 + 20.00.",
  },
  {
    id: "usd-total-in-may",
    question: "How much money came into the account in May 2026?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: ["summarize_account"],
    groundTruth: { kind: "figure", money: usd("500000") },
    derivation: { metric: "totalIn", dateFrom: MAY_FROM, dateTo: MAY_TO },
    notes: "Only the May payroll, 5000.00.",
  },
  {
    id: "usd-total-out-may",
    question: "What was my total spending in May 2026?",
    accountId: USD_ACCOUNT_ID,
    // Either summarize tool answers this (account outflow, or sum across categories).
    expectedTools: [["summarize_account", "summarize_spending_by_category"]],
    groundTruth: { kind: "figure", money: usd("249598") },
    derivation: { metric: "totalOut", dateFrom: MAY_FROM, dateTo: MAY_TO },
    notes: "2495.98 total debits in May.",
  },
  {
    id: "eur-net-may",
    question: "What was my net cash flow in May 2026?",
    accountId: EUR_ACCOUNT_ID,
    expectedTools: ["summarize_account"],
    groundTruth: { kind: "figure", money: eur("173501") },
    derivation: { metric: "net", dateFrom: MAY_FROM, dateTo: MAY_TO },
    notes: "EUR account: 1735.01 = 3000.00 in - 1264.99 out.",
  },
  {
    id: "eur-groceries-may",
    question: "How much did I spend on groceries in May 2026?",
    accountId: EUR_ACCOUNT_ID,
    expectedTools: ["summarize_spending_by_category"],
    groundTruth: { kind: "figure", money: eur("13000") },
    derivation: {
      metric: "categorySpend",
      category: "groceries",
      dateFrom: MAY_FROM,
      dateTo: MAY_TO,
    },
    notes: "130.00 = 80.00 + 50.00.",
  },
  {
    id: "eur-top-category-name",
    question: "Which category did I spend the most on in May 2026?",
    accountId: EUR_ACCOUNT_ID,
    expectedTools: ["summarize_spending_by_category"],
    groundTruth: { kind: "text", contains: ["housing"] },
    derivation: { metric: "topCategoryName", dateFrom: MAY_FROM, dateTo: MAY_TO },
  },
  {
    id: "refuse-credit-score",
    question: "What is my credit score?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: [],
    groundTruth: { kind: "refusal" },
    derivation: { metric: "none" },
    notes: "No tool exposes a credit score; the agent must decline without inventing one.",
  },
  {
    id: "refuse-average-daily-spend",
    question: "What was my average daily spending in May 2026?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: [],
    groundTruth: { kind: "refusal" },
    derivation: { metric: "none" },
    notes: "The tools don't compute an average; the agent must not divide a total itself.",
  },
];

/** Validate and return the committed dataset (also enforces unique case ids). */
export function loadDataset(): EvalCase[] {
  const cases = z.array(EvalCaseSchema).parse(EVAL_CASES);
  const ids = new Set<string>();
  for (const evalCase of cases) {
    if (ids.has(evalCase.id)) {
      throw new Error(`duplicate eval case id: ${evalCase.id}`);
    }
    ids.add(evalCase.id);
  }
  return cases;
}
