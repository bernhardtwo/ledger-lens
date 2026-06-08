/**
 * DI token for the Q&A agent seam (ADR-0008). A `symbol` token — token-based DI
 * (no `emitDecoratorMetadata`), injected with `@Inject`. Tests override it with a
 * scripted double so no suite ever calls the real API.
 */
export const QA_AGENT = Symbol("QA_AGENT");
