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

/** The answer must contain this exact figure. */
const FigureGroundTruthSchema = z.object({ kind: z.literal("figure"), money: MoneySchema });
/** The answer must contain these substring(s) (e.g. the top category name). */
const TextGroundTruthSchema = z.object({
  kind: z.literal("text"),
  contains: z.array(z.string().min(1)).min(1),
});

/** One element of a compound (`all`) ground truth — a single figure or text. */
const GroundTruthPartSchema = z.discriminatedUnion("kind", [
  FigureGroundTruthSchema,
  TextGroundTruthSchema,
]);
export type GroundTruthPart = z.infer<typeof GroundTruthPartSchema>;

/** What a correct answer must carry. */
const GroundTruthSchema = z.discriminatedUnion("kind", [
  FigureGroundTruthSchema,
  TextGroundTruthSchema,
  /** The tools cannot answer: the agent must decline, fabricating no figure. */
  z.object({ kind: z.literal("refusal") }),
  /**
   * **Composition** (multi-tool): the answer must satisfy EVERY part — each scored
   * by its own matcher (figure / text). Passes iff all parts pass. This is what
   * makes a "needs 2+ tools" case test that the answer relays BOTH results, not
   * just that both tools were called.
   */
  z.object({ kind: z.literal("all"), parts: z.array(GroundTruthPartSchema).min(2) }),
]);
export type GroundTruth = z.infer<typeof GroundTruthSchema>;

/** The metrics that derive a single figure/text from the seed (a part, or a non-compound case). */
const PART_METRICS = [
  "net",
  "totalIn",
  "totalOut",
  "categorySpend",
  "topCategoryAmount",
  "topCategoryName",
] as const;

const PartDerivationSchema = z.object({
  metric: z.enum(PART_METRICS),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
  category: CategorySchema.optional(),
});
export type PartDerivation = z.infer<typeof PartDerivationSchema>;

/** How a case's ground truth is computed from the seed (input to the consistency test). */
const DerivationSchema = z.object({
  metric: z.enum([...PART_METRICS, "none", "compound"]),
  dateFrom: IsoDateSchema.optional(),
  dateTo: IsoDateSchema.optional(),
  category: CategorySchema.optional(),
  /** Present only when `metric === "compound"`: one derivation per ground-truth part. */
  parts: z.array(PartDerivationSchema).optional(),
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
const APR_FROM = isoDate("2026-04-01");
const APR_TO = isoDate("2026-04-30");
const JUN_FROM = isoDate("2026-06-01");
const JUN_TO = isoDate("2026-06-30");

const usd = (amount: string) => ({ amount, currency: "USD", minorUnitExponent: 2 }) as const;
const eur = (amount: string) => ({ amount, currency: "EUR", minorUnitExponent: 2 }) as const;

/**
 * The committed golden cases (~23 across both accounts). Beyond the base
 * single-figure cases: **multi-tool composition** (`all` — the answer must relay
 * both results), **edge/partial/ambiguous date ranges** (single month, a quarter,
 * a month-straddling partial range), **large odd-cents figures** (the decimal
 * path), and **honesty refusals** (questions the tools genuinely can't answer).
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
    groundTruth: { kind: "figure", money: usd("2318045") },
    derivation: { metric: "net" },
    notes:
      "All-time (Apr+May+Jun) net inflow 23,180.45 — recomputed from the seed by the consistency test.",
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

  // ---- Expanded set (Phase 5): harder, discriminating cases ----

  // Multi-tool composition — the answer must relay BOTH results (`all`), and both
  // tools must be called. Uses existing May data.
  {
    id: "usd-multi-net-and-groceries",
    question:
      "What was my net cash flow in May 2026, and how much did I spend on groceries that month?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: ["summarize_account", "summarize_spending_by_category"],
    groundTruth: {
      kind: "all",
      parts: [
        { kind: "figure", money: usd("250402") },
        { kind: "figure", money: usd("20000") },
      ],
    },
    derivation: {
      metric: "compound",
      parts: [
        { metric: "net", dateFrom: MAY_FROM, dateTo: MAY_TO },
        { metric: "categorySpend", category: "groceries", dateFrom: MAY_FROM, dateTo: MAY_TO },
      ],
    },
    notes: "Composition: net 2504.02 AND groceries 200.00.",
  },
  {
    id: "usd-multi-topcat-and-income",
    question:
      "In May 2026, which category did I spend the most on, and how much money came into the account?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: ["summarize_spending_by_category", "summarize_account"],
    groundTruth: {
      kind: "all",
      parts: [
        { kind: "text", contains: ["housing"] },
        { kind: "figure", money: usd("500000") },
      ],
    },
    derivation: {
      metric: "compound",
      parts: [
        { metric: "topCategoryName", dateFrom: MAY_FROM, dateTo: MAY_TO },
        { metric: "totalIn", dateFrom: MAY_FROM, dateTo: MAY_TO },
      ],
    },
    notes: "Composition: top category housing AND income 5000.00.",
  },
  {
    id: "eur-multi-net-and-top",
    question: "What was my net cash flow in May 2026 and my biggest spending category?",
    accountId: EUR_ACCOUNT_ID,
    expectedTools: ["summarize_account", "summarize_spending_by_category"],
    groundTruth: {
      kind: "all",
      parts: [
        { kind: "figure", money: eur("173501") },
        { kind: "text", contains: ["housing"] },
      ],
    },
    derivation: {
      metric: "compound",
      parts: [
        { metric: "net", dateFrom: MAY_FROM, dateTo: MAY_TO },
        { metric: "topCategoryName", dateFrom: MAY_FROM, dateTo: MAY_TO },
      ],
    },
    notes: "Cross-currency composition: EUR net 1735.01 AND top category housing.",
  },

  // Ambiguous / edge date ranges — discriminate on picking the right range.
  {
    id: "usd-april-spending",
    question: "How much did I spend in total in April 2026?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: [["summarize_account", "summarize_spending_by_category"]],
    groundTruth: { kind: "figure", money: usd("215000") },
    derivation: { metric: "totalOut", dateFrom: APR_FROM, dateTo: APR_TO },
    notes: "April debits 2150.00 = 2000.00 rent + 150.00 groceries (distinct from May).",
  },
  {
    id: "usd-q2-inflow",
    // "Total inflow", NOT "income": the tools have no income-only total (totalIn is
    // all credits, which equals income here only by seed coincidence). Asking for
    // inflow makes summarize_account.totalIn the unambiguous, honest answer.
    question: "How much money came in (total inflow) from April through June 2026?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: ["summarize_account"],
    groundTruth: { kind: "figure", money: usd("3017543") },
    derivation: { metric: "totalIn", dateFrom: APR_FROM, dateTo: JUN_TO },
    notes: "Broad range + large magnitude: 30,175.43 = 3x 5000.00 payroll + 15,175.43 bonus.",
  },
  {
    id: "usd-june-net",
    question: "What was my net cash flow in June 2026?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: ["summarize_account"],
    groundTruth: { kind: "figure", money: usd("1782643") },
    derivation: { metric: "net", dateFrom: JUN_FROM, dateTo: JUN_TO },
    notes: "June: large odd-cents net 17,826.43; includes the 06-01 boundary payroll.",
  },
  {
    id: "usd-partial-range-groceries",
    question: "How much did I spend on groceries between 2026-04-20 and 2026-05-05?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: ["summarize_spending_by_category"],
    groundTruth: { kind: "figure", money: usd("35000") },
    derivation: {
      metric: "categorySpend",
      category: "groceries",
      dateFrom: isoDate("2026-04-20"),
      dateTo: isoDate("2026-05-05"),
    },
    notes: "Month-straddling partial range: 350.00 = 150.00 (Apr 20) + 125.00 + 75.00 (May).",
  },
  {
    id: "eur-q2-net",
    question: "What was my net cash flow across April through June 2026?",
    accountId: EUR_ACCOUNT_ID,
    expectedTools: ["summarize_account"],
    groundTruth: { kind: "figure", money: eur("353501") },
    derivation: { metric: "net", dateFrom: APR_FROM, dateTo: JUN_TO },
    notes: "EUR Q2 net 3535.01 = 6000.00 in (Apr+May payroll) - 2464.99 out (May + June travel).",
  },

  // Honesty / refusal — tools genuinely cannot answer.
  {
    id: "refuse-balance",
    question: "What is my current account balance?",
    accountId: USD_ACCOUNT_ID,
    expectedTools: [],
    groundTruth: { kind: "refusal" },
    derivation: { metric: "none" },
    notes:
      "The domain exposes flows + transactions, not a running balance; the agent must decline.",
  },
  {
    id: "refuse-forecast",
    question: "How much will I spend next month?",
    accountId: EUR_ACCOUNT_ID,
    expectedTools: [],
    groundTruth: { kind: "refusal" },
    derivation: { metric: "none" },
    notes: "No prediction tool; the agent must decline rather than invent a forecast.",
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
