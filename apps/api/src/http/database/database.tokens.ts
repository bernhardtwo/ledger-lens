/**
 * DI token for the Drizzle database handle. A `symbol` token (not a class) — DI is
 * deliberately token-based (no `emitDecoratorMetadata`), so every consumer injects
 * this with `@Inject(DATABASE)`.
 */
export const DATABASE = Symbol("DATABASE");
