/**
 * Minimal Zod validation pipe (see spec 0001: "a small `ZodValidationPipe`").
 *
 * Instantiated explicitly per binding — `@Param("accountId", new
 * ZodValidationPipe(AccountIdSchema))` — so it carries no DI metadata. A failed
 * parse becomes a `400` with the Zod issues; a success returns the parsed
 * (coerced/defaulted) value.
 */
import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

export class ZodValidationPipe<TOutput> implements PipeTransform<unknown, TOutput> {
  constructor(private readonly schema: ZodSchema<TOutput>) {}

  transform(value: unknown): TOutput {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({ message: "validation failed", issues: result.error.issues });
    }
    return result.data;
  }
}
