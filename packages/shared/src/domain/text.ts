/**
 * Canonical text normalization for transaction descriptions (see spec 0001).
 *
 * Bank descriptions are noisy: inconsistent casing, runs of whitespace, padding,
 * and compatibility/accented Unicode forms ("CAFÉ  BAR  #12 " vs "Café Bar #12").
 * Two things must agree on a single canonical form:
 *
 *  1. the stored `Transaction.description`, and
 *  2. the dedupe `fingerprint` (spec 0001, step 5),
 *
 * because the fingerprint hashes the *normalized* description. If they used
 * different normalizers, two renderings of the same description could either
 * duplicate (fingerprints diverge) or wrongly collapse — defeating idempotency.
 * `normalizeDescription` is therefore the **single** normalizer both must use.
 *
 * It is **idempotent** — `normalizeDescription(normalizeDescription(x)) ===
 * normalizeDescription(x)` — which is what makes it safe as a fingerprint input:
 * re-normalizing an already-normalized value never shifts the dedupe key.
 */

/**
 * Normalize a raw description to its canonical form: Unicode NFKC folding, then
 * whitespace runs collapsed to a single space, trimmed, and upper-cased.
 *
 * The transformation is idempotent (see module doc): each step is stable under
 * re-application, so the composition is too. This is the only normalization
 * applied to a transaction's description and to the fingerprint that dedupes it.
 */
export function normalizeDescription(raw: string): string {
  return raw
    .normalize("NFKC") // fold compatibility/accent forms to one canonical encoding
    .replace(/\s+/g, " ") // collapse any run of whitespace to a single space
    .trim() // drop leading/trailing space introduced or left by the collapse
    .toUpperCase(); // case-fold last so dedupe ignores casing differences
}
