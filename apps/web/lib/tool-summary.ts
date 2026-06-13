/**
 * Summarise a tool call's KEY inputs for the "show your work" trail (spec 0006
 * decision 3) — date range, category, direction, row limit, and NOTHING else.
 *
 * This is a determinism-first guard at the presentation boundary (ADR-0004). Tool
 * inputs arrive as an open `Record<string, unknown>` off the wire, so we ALLOW-LIST
 * only known figure-free keys: should a tool input ever gain a money field, it is
 * never rendered here — every amount appears solely in the agent's answer text.
 */
export function toolInputSummary(input: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof input.dateFrom === "string" && typeof input.dateTo === "string") {
    parts.push(`${input.dateFrom} → ${input.dateTo}`);
  } else if (typeof input.dateFrom === "string") {
    parts.push(`from ${input.dateFrom}`);
  } else if (typeof input.dateTo === "string") {
    parts.push(`through ${input.dateTo}`);
  }
  if (typeof input.category === "string") {
    parts.push(input.category);
  }
  if (typeof input.direction === "string") {
    parts.push(input.direction);
  }
  if (typeof input.limit === "number") {
    parts.push(`limit ${input.limit}`); // a row count, never money
  }
  return parts.join(" · ");
}
