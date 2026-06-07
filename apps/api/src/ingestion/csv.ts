/**
 * CSV tokenizing (see spec 0001, step 1) — the only step that touches CSV dialect.
 * Everything downstream is pure.
 */
import { parse } from "csv-parse/sync";

export interface CsvTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Tokenize CSV text into a header row + data rows, using `csv-parse` with:
 *  - `bom: true` — strip a UTF-8 BOM on the first cell, which would otherwise
 *    corrupt the header signature and break profile matching;
 *  - `relax_column_count: true` — return ragged rows as-is so the pipeline can
 *    reject them per-row ("column count mismatch") instead of throwing;
 *  - `skip_empty_lines: true` — drop blank/trailing lines;
 *  - `relax_quotes: true` — tolerate stray quotes rather than aborting the file.
 */
export function parseCsvTable(text: string): CsvTable {
  const records = parse(text, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: false,
  }) as string[][];

  const [header, ...rows] = records;
  return { header: header ?? [], rows };
}
