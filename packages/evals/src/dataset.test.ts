import { DEMO_SEED } from "@ledger-lens/db";
import { describe, expect, it } from "vitest";
import { EVAL_CASES, loadDataset } from "./dataset.js";
import { computeGroundTruth } from "./ground-truth.js";

describe("dataset", () => {
  it("validates and has unique case ids", () => {
    const cases = loadDataset();
    expect(cases.length).toBe(EVAL_CASES.length);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it("every case targets a seeded account", () => {
    const seededIds = new Set(DEMO_SEED.map((seed) => seed.account.id));
    for (const evalCase of loadDataset()) {
      expect(seededIds.has(evalCase.accountId)).toBe(true);
    }
  });

  // The determinism-first guard: committed ground truth must equal what the seed
  // produces through the real money folds, so the dataset can never silently drift.
  it("committed ground truth equals what the seed produces (consistency)", () => {
    const seedByAccount = new Map(DEMO_SEED.map((seed) => [seed.account.id, seed]));
    for (const evalCase of loadDataset()) {
      const seed = seedByAccount.get(evalCase.accountId);
      expect(seed, `seed for ${evalCase.id}`).toBeDefined();
      if (seed === undefined) {
        continue;
      }
      const computed = computeGroundTruth(seed.rows, seed.account.currency, evalCase.derivation);
      expect(computed, `ground truth for ${evalCase.id}`).toEqual(evalCase.groundTruth);
    }
  });
});
