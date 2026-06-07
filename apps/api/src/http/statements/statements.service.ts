/**
 * Statements service — the thin orchestration edge: it 404s an unknown account,
 * then runs the EXISTING deterministic ingestion core and persistence repository.
 * It contains no parsing/money/dedupe logic of its own.
 */
import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { getAccountById } from "../../db/accounts.repository.js";
import type { Database } from "../../db/client.js";
import { persistIngestion } from "../../db/repository.js";
import { ingestCsv } from "../../ingestion/index.js";
import { DATABASE } from "../database/database.tokens.js";
import type { StatementIngestResponse } from "./statements.dto.js";

/** The slice of an uploaded file the service needs. */
export interface UploadedCsv {
  readonly buffer: Buffer;
  readonly originalname: string;
}

@Injectable()
export class StatementsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async ingest(accountId: string, file: UploadedCsv): Promise<StatementIngestResponse> {
    const account = await getAccountById(this.db, accountId);
    if (account === null) {
      throw new NotFoundException(`account ${accountId} not found`);
    }

    // Throws IngestionError (mapped to 4xx by the exception filter) on a fatal file.
    const result = ingestCsv({ content: file.buffer, accountId });

    // The profile fixes each transaction's currency; it must match the account's,
    // or we would silently persist (say) EUR rows under a USD account. Checked
    // before persisting so no mismatched data is written. (Header-only files have
    // no transactions and no currency to check.)
    const fileCurrency = result.accepted[0]?.amount.currency;
    if (fileCurrency !== undefined && fileCurrency !== account.currencyCode) {
      throw new UnprocessableEntityException({
        error: "currency-mismatch",
        message: `file currency ${fileCurrency} does not match account currency ${account.currencyCode}`,
      });
    }

    const persisted = await persistIngestion(this.db, {
      accountId,
      sourceFilename: file.originalname,
      profileId: result.profileId,
      accepted: result.accepted,
    });

    return {
      statementId: persisted.statementId,
      profileId: result.profileId,
      inserted: persisted.inserted,
      skipped: persisted.skipped,
      rejected: [...result.rejected],
    };
  }
}
