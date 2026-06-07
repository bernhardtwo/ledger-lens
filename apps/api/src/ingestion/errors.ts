/**
 * Ingestion error model (see spec 0001, "Error handling").
 *
 * Two distinct failure granularities:
 *
 *  - `IngestionError` — a **fatal**, whole-file condition. The kinds mirror the
 *    spec's discriminated union and will map to HTTP codes once the NestJS layer
 *    lands (this phase has no HTTP).
 *  - `RowRejection` — a **non-fatal**, single-row problem. The pipeline collects
 *    it into `rejected[]` with a precise reason and keeps going; one bad row never
 *    fails the file.
 */

/** Fatal, whole-file ingestion failure kinds. */
export type IngestionErrorKind =
  | "empty-file"
  | "not-utf8"
  | "unknown-profile"
  | "too-many-rejected";

/** A fatal ingestion failure that aborts the whole file. */
export class IngestionError extends Error {
  override readonly name = "IngestionError";
  readonly kind: IngestionErrorKind;
  /** The unrecognized header signature — present only for `unknown-profile`. */
  readonly signature?: string;

  constructor(kind: IngestionErrorKind, message: string, options?: { signature?: string }) {
    super(message);
    this.kind = kind;
    // exactOptionalPropertyTypes: only set when actually provided (never assign undefined).
    if (options?.signature !== undefined) {
      this.signature = options.signature;
    }
  }
}

/**
 * A single row that cannot be normalized. Non-fatal: thrown by the field parsers
 * / `normalizeRow` and caught by the orchestrator, which records the reason in
 * `rejected[]`. Internal to the ingestion core.
 */
export class RowRejection extends Error {
  override readonly name = "RowRejection";
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}
