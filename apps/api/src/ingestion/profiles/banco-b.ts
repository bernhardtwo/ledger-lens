import type { MappingProfile } from "./types.js";

/**
 * Synthetic Spanish bank export. Separate `Cargo` (debit) / `Abono` (credit)
 * columns, `DD/MM/YYYY` dates, EUR amounts with `,`-decimals and `.` thousands
 * grouping, and a distinct value date (`Fecha Valor`). Fictional layout —
 * synthetic data only. (Spanish banks use comma decimals; Mexican banks use
 * period decimals, so the comma-decimal example is modelled as EUR, not MXN.)
 */
export const bancoB: MappingProfile = {
  id: "banco-b@v1",
  expectedHeaders: ["Fecha", "Fecha Valor", "Concepto", "Cargo", "Abono"],
  currency: "EUR",
  dateFormat: "DD/MM/YYYY",
  transactionDateColumn: "Fecha",
  postedDateColumn: "Fecha Valor",
  descriptionColumns: ["Concepto"],
  amount: { kind: "debit-credit-columns", debitColumn: "Cargo", creditColumn: "Abono" },
  numberFormat: { decimalSeparator: ",", parenthesesNegative: false },
};
