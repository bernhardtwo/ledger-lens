/**
 * Categorization service — the thin orchestration edge (see spec 0002). It 404s an
 * unknown account, reads the account's UNCATEGORIZED transactions, runs the pure
 * core over the injected client, persists the assignments, and reports counts. No
 * batching/validation/money logic of its own — that all lives in the pure core.
 */
import {
  type CategoryAssignment,
  type Database,
  applyCategorizations,
  getAccountById,
  listUncategorizedTransactions,
} from "@ledger-lens/db";
import { UNCATEGORIZED } from "@ledger-lens/shared";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { categorizeTransactions } from "../../categorization/core.js";
import type { CategorizationClient } from "../../categorization/types.js";
import { DATABASE } from "../database/database.tokens.js";
import type { CategorizeResponse } from "./categorization.dto.js";
import { CATEGORIZATION_CLIENT } from "./categorization.tokens.js";

/** Resolve the batch size from env, falling back to the core default. */
function batchSize(): number | undefined {
  const raw = Number.parseInt(process.env.ANTHROPIC_CATEGORIZATION_BATCH_SIZE ?? "", 10);
  return Number.isInteger(raw) && raw > 0 ? raw : undefined;
}

@Injectable()
export class CategorizationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CATEGORIZATION_CLIENT) private readonly client: CategorizationClient,
  ) {}

  async categorizeAccount(accountId: string): Promise<CategorizeResponse> {
    const account = await getAccountById(this.db, accountId);
    if (account === null) {
      throw new NotFoundException(`account ${accountId} not found`);
    }

    const pending = await listUncategorizedTransactions(this.db, accountId);
    if (pending.length === 0) {
      return { totalUncategorized: 0, categorized: 0, uncategorized: 0, failed: 0 };
    }

    const run = await categorizeTransactions(pending, this.client, batchSize());
    const assignments: CategoryAssignment[] = [...run.assignments].map(([id, category]) => ({
      id,
      category,
    }));
    const updatedIds = new Set(
      await applyCategorizations(this.db, assignments, this.client.modelId, new Date()),
    );

    // Count only rows actually persisted this run — a row categorized by a
    // concurrent run is skipped by the `category IS NULL` guard and excluded.
    let categorized = 0;
    let uncategorized = 0;
    for (const { id, category } of assignments) {
      if (!updatedIds.has(id)) {
        continue;
      }
      if (category === UNCATEGORIZED) {
        uncategorized += 1;
      } else {
        categorized += 1;
      }
    }

    return {
      totalUncategorized: pending.length,
      categorized,
      uncategorized,
      failed: run.failedIds.length,
    };
  }
}
