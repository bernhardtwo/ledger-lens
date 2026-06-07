import type { MappingProfile } from "./types.js";

/**
 * Synthetic US-style bank export. A single signed `Amount` (negative = money
 * out), `MM/DD/YYYY` dates, and `.`-decimals with `,` thousands grouping. No
 * separate posting date. Fictional layout — synthetic data only.
 */
export const bankA: MappingProfile = {
  id: "bank-a@v1",
  expectedHeaders: ["Date", "Description", "Amount"],
  currency: "USD",
  dateFormat: "MM/DD/YYYY",
  transactionDateColumn: "Date",
  postedDateColumn: null,
  descriptionColumns: ["Description"],
  amount: { kind: "signed-amount", column: "Amount", debitSign: "negative" },
  numberFormat: { decimalSeparator: ".", parenthesesNegative: true },
};
