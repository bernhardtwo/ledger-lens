/**
 * DI token for the categorization client seam (ADR-0006). A `symbol` token —
 * token-based DI (no `emitDecoratorMetadata`), injected with `@Inject`. Tests
 * override it with a mock so no suite ever hits the real API.
 */
export const CATEGORIZATION_CLIENT = Symbol("CATEGORIZATION_CLIENT");
