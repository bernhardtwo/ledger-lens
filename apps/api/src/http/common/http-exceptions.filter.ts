import { InvalidCursorError } from "@ledger-lens/db";
/**
 * Global exception filter (see spec 0001, "HTTP error mapping").
 *
 * Maps domain + upload errors to the documented status codes and ensures nothing
 * escapes as an unhandled 500 with a raw library message:
 *  - `IngestionError`: empty-file / not-utf8 -> 400, unknown-profile /
 *    too-many-rejected -> 422 (the unrecognized header `signature` is surfaced);
 *  - `InvalidCursorError` -> 400;
 *  - Multer errors: oversized upload (`LIMIT_FILE_SIZE`) -> 413, other multipart
 *    failures -> 400 (matched by `name`, robust across package copies);
 *  - any `HttpException` (bad uuid/query, missing file, wrong type, unknown
 *    account) -> its own status;
 *  - anything else -> 500 without leaking internals.
 */
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import { IngestionError, type IngestionErrorKind } from "../../ingestion/index.js";

const INGESTION_STATUS: Record<IngestionErrorKind, number> = {
  "empty-file": HttpStatus.BAD_REQUEST,
  "not-utf8": HttpStatus.BAD_REQUEST,
  "unknown-profile": HttpStatus.UNPROCESSABLE_ENTITY,
  "too-many-rejected": HttpStatus.UNPROCESSABLE_ENTITY,
};

/** A Multer multipart error, matched by `name` so it survives duplicate package copies. */
interface MulterLikeError {
  readonly name: "MulterError";
  readonly code: string;
  readonly message: string;
}

function isMulterError(error: unknown): error is MulterLikeError {
  return (
    error instanceof Error &&
    error.name === "MulterError" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

@Catch()
export class HttpExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof IngestionError) {
      response.status(INGESTION_STATUS[exception.kind]).json({
        error: exception.kind,
        message: exception.message,
        ...(exception.signature !== undefined ? { signature: exception.signature } : {}),
      });
      return;
    }

    if (exception instanceof InvalidCursorError) {
      response
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: "malformed-cursor", message: exception.message });
      return;
    }

    if (isMulterError(exception)) {
      const tooLarge = exception.code === "LIMIT_FILE_SIZE";
      response
        .status(tooLarge ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST)
        .json({ error: tooLarge ? "file-too-large" : "upload-error", message: exception.message });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      response
        .status(status)
        .json(typeof payload === "string" ? { statusCode: status, message: payload } : payload);
      return;
    }

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: "internal server error" });
  }
}
