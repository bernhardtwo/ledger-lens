/**
 * Calendar date (`YYYY-MM-DD`) value (see spec 0001, ADR-0004).
 *
 * A statement's transaction/posting date is a **calendar date**, not an instant:
 * "2026-01-15" denotes a day, and there is no correct `Date` for it without
 * inventing a timezone. Binding it to a JS `Date` would inject timezone
 * ambiguity (a UTC-midnight `Date` renders as the previous day west of GMT) —
 * exactly the kind of silent, environment-dependent error a finance app must not
 * have. So calendar dates are kept as a branded ISO-8601 `YYYY-MM-DD` string in
 * both the domain and at the boundary; only true instants (e.g. a statement's
 * `ingestedAt`) use `Date`.
 *
 * The brand makes an `IsoDate` unconstructible from an arbitrary `string`: a
 * value must pass `IsoDateSchema` (format + real-calendar-date validation),
 * which keeps malformed dates out of the domain.
 */
import { z } from "zod";

/** Zod schema for a calendar date string `YYYY-MM-DD`, branded as `IsoDate`. */
export const IsoDateSchema = z.string().date().brand<"IsoDate">();

/** A validated calendar date string (`YYYY-MM-DD`). No time, no timezone. */
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** Validate and brand a calendar-date string. Throws on a malformed date. */
export function isoDate(value: string): IsoDate {
  return IsoDateSchema.parse(value);
}
