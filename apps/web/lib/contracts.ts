/**
 * The client's view of the API contracts: re-exported verbatim from
 * `@ledger-lens/shared` so the web app validates responses against the SAME Zod
 * symbol the server validates against (single source of truth; spec 0006). The web
 * never re-declares a DTO. Transactions/ask/statement envelopes are surfaced here
 * now for the Chunk C surfaces; Chunk B uses only the accounts envelope.
 */
export {
  AccountSchema,
  AccountsResponseSchema,
  AgentEventSchema,
  AskResponseSchema,
  CategorizeResponseSchema,
  StatementIngestResponseSchema,
  ToolCallSchema,
  TransactionListItemResponseSchema,
  TransactionsPageResponseSchema,
} from "@ledger-lens/shared";
export type {
  Account,
  AccountsResponse,
  AgentEvent,
  AskResponse,
  Category,
  CategorizeResponse,
  Direction,
  MoneyDTO,
  StatementIngestResponse,
  TransactionListItemResponse,
  TransactionsPageResponse,
} from "@ledger-lens/shared";
