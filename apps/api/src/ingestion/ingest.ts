/**
 * Deterministic CSV ingestion core (see spec 0001) — no LLM, no DB, no HTTP.
 *
 * Pipeline: decode UTF-8 -> tokenize -> resolve profile by header signature ->
 * per-row normalize + Zod-validate (collecting, not throwing, on bad rows) ->
 * fingerprint. Throws `IngestionError` only for whole-file failures.
 */
import { type TransactionDraftDTO, TransactionDraftSchema, toMoneyDTO } from "@ledger-lens/shared";
import { z } from "zod";
import { parseCsvTable } from "./csv.js";
import { IngestionError, RowRejection } from "./errors.js";
import { fingerprintAccepted } from "./fingerprint.js";
import { normalizeRow } from "./normalize.js";
import { resolveProfile } from "./profiles/index.js";
import type { IngestResult, NormalizedRow, RejectedRow, TransactionDraft } from "./types.js";

/** Fail the whole ingest when more than this fraction of data rows are rejected. */
const MAX_REJECT_RATIO = 0.5;

/**
 * Structural trust boundary (spec step 4): validate the normalized shape minus the
 * server-computed `fingerprint`. The field parsers already reject bad dates/amounts
 * with precise reasons; this catches the structural rest (e.g. an empty description).
 */
const NormalizedDraftSchema = TransactionDraftSchema.omit({ fingerprint: true });

const AccountIdSchema = z.string().uuid();

export interface IngestCsvInput {
  /** Raw file content. Bytes are decoded as strict UTF-8 (other encodings: future phase). */
  readonly content: string | Uint8Array;
  /** The account these transactions belong to (uuid). */
  readonly accountId: string;
}

/** Ingest one CSV file deterministically. */
export function ingestCsv(input: IngestCsvInput): IngestResult {
  const accountId = AccountIdSchema.parse(input.accountId);
  const text = decodeUtf8(input.content);

  const { header, rows } = parseCsvTable(text);
  if (header.length === 0) {
    // Truly empty: no header row / no content. Distinct from a header-only file
    // (valid headers, zero data rows), which is a valid empty statement below.
    throw new IngestionError("empty-file", "the file has no header row / no content");
  }
  const profile = resolveProfile(header);

  const accepted: NormalizedRow[] = [];
  const rejected: RejectedRow[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 1; // 1-based, header excluded
    if (row.length !== header.length) {
      rejected.push({ row: rowNumber, reason: "column count mismatch" });
      return;
    }
    try {
      const normalized = normalizeRow(profile, zip(header, row));
      const validation = NormalizedDraftSchema.safeParse(toDraftDto(accountId, normalized));
      if (!validation.success) {
        rejected.push({ row: rowNumber, reason: firstIssue(validation.error) });
        return;
      }
      accepted.push(normalized);
    } catch (error) {
      if (error instanceof RowRejection) {
        rejected.push({ row: rowNumber, reason: error.reason });
        return;
      }
      throw error;
    }
  });

  const total = rows.length;
  if (total > 0 && rejected.length / total > MAX_REJECT_RATIO) {
    throw new IngestionError(
      "too-many-rejected",
      `rejected ${rejected.length}/${total} rows (> ${MAX_REJECT_RATIO * 100}%) — likely the wrong profile`,
    );
  }

  const drafts: TransactionDraft[] = fingerprintAccepted(accountId, accepted).map(
    ({ row, fingerprint }) => ({ ...row, accountId, fingerprint }),
  );

  return { profileId: profile.id, accepted: drafts, rejected };
}

/** Decode bytes as strict UTF-8; a string passes through unchanged. */
function decodeUtf8(content: string | Uint8Array): string {
  if (typeof content === "string") {
    return content;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new IngestionError(
      "not-utf8",
      "input is not valid UTF-8 (other encodings are a future phase)",
    );
  }
}

/** Pair a row's cells with the header into a record. Missing cells read as "". */
function zip(header: readonly string[], row: readonly string[]): Record<string, string> {
  const record: Record<string, string> = {};
  header.forEach((key, index) => {
    record[key] = row[index] ?? "";
  });
  return record;
}

/** Build the boundary DTO (minus fingerprint) for Zod validation. */
function toDraftDto(
  accountId: string,
  row: NormalizedRow,
): Omit<TransactionDraftDTO, "fingerprint"> {
  return {
    accountId,
    transactionDate: row.transactionDate,
    postedDate: row.postedDate,
    description: row.description,
    direction: row.direction,
    amount: toMoneyDTO(row.amount),
    rawRow: { ...row.rawRow },
  };
}

/** A concise, human-readable reason from the first Zod issue. */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) {
    return "invalid row";
  }
  const path = issue.path.join(".");
  return path === "" ? issue.message : `${path}: ${issue.message}`;
}
