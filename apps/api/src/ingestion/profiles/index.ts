/**
 * Profile registry + selection (see spec 0001, step 2).
 *
 * Selection is exact-match on a canonical header signature. No match fails fast
 * with the detected signature, so supporting a new bank is a reviewable config
 * PR (add a profile) — never an LLM guess. A signature collision between two
 * profiles is a config bug and throws at load.
 */
import { IngestionError } from "../errors.js";
import { bancoB } from "./banco-b.js";
import { bankA } from "./bank-a.js";
import type { MappingProfile } from "./types.js";

export type { AmountStrategy, DateFormat, MappingProfile, NumberFormat } from "./types.js";

/** All registered profiles. Adding a bank format is a reviewable change here. */
export const PROFILES: readonly MappingProfile[] = [bankA, bancoB];

/**
 * Canonical header signature: trimmed, lower-cased, sorted column names joined by
 * "|". Order-independent (column reordering still matches) and the single lookup
 * key for profile selection.
 */
export function canonicalSignature(headers: readonly string[]): string {
  return headers
    .map((header) => header.trim().toLowerCase())
    .sort()
    .join("|");
}

/**
 * Build the signature -> profile index, throwing on a collision (two profiles
 * claiming the same header signature). Exported so the invariant is unit-testable.
 */
export function buildProfileIndex(
  profiles: readonly MappingProfile[],
): ReadonlyMap<string, MappingProfile> {
  const index = new Map<string, MappingProfile>();
  for (const profile of profiles) {
    const signature = canonicalSignature(profile.expectedHeaders);
    const existing = index.get(signature);
    if (existing !== undefined) {
      throw new Error(
        `profile signature collision: "${existing.id}" and "${profile.id}" share header signature "${signature}"`,
      );
    }
    index.set(signature, profile);
  }
  return index;
}

const PROFILE_INDEX = buildProfileIndex(PROFILES);

/**
 * Resolve the mapping profile for a CSV's headers by exact signature match.
 * Throws `IngestionError("unknown-profile")` carrying the detected signature when
 * nothing matches.
 */
export function resolveProfile(headers: readonly string[]): MappingProfile {
  const signature = canonicalSignature(headers);
  const profile = PROFILE_INDEX.get(signature);
  if (profile === undefined) {
    throw new IngestionError(
      "unknown-profile",
      `no mapping profile for header signature "${signature}"`,
      { signature },
    );
  }
  return profile;
}
