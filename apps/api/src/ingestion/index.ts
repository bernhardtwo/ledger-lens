/**
 * Public surface of the deterministic CSV ingestion core (Phase 1).
 * The NestJS HTTP layer and persistence (later chunks) build on these.
 */
export { ingestCsv } from "./ingest.js";
export type { IngestCsvInput } from "./ingest.js";
export { IngestionError } from "./errors.js";
export type { IngestionErrorKind } from "./errors.js";
export type { IngestResult, NormalizedRow, RejectedRow, TransactionDraft } from "./types.js";
export { PROFILES, canonicalSignature, resolveProfile } from "./profiles/index.js";
export type { MappingProfile } from "./profiles/index.js";
