/**
 * `POST /accounts/:accountId/statements` — multipart CSV upload (field `file`).
 *
 * Express + Multer (default in-memory storage gives `file.buffer`). Validation at
 * the edge: account id via Zod (400), a CSV-ish content type via the Multer
 * `fileFilter` (415), and a 5 MB cap via an explicit size check (413). On success
 * → 201 when a statement was created, 200 on an idempotent no-op.
 */
import {
  BadRequestException,
  Controller,
  HttpStatus,
  Inject,
  Param,
  PayloadTooLargeException,
  Post,
  Res,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import {
  AccountIdSchema,
  type StatementIngestResponse,
  StatementIngestResponseSchema,
} from "./statements.dto.js";
import { StatementsService } from "./statements.service.js";

const MAX_FILE_MB = 5;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
// Deliberately narrow: a genuine CSV is `text/csv`/`application/csv`, or any type
// with a `.csv` name (browsers are inconsistent). `text/plain`/`vnd.ms-excel` are
// excluded so a renamed `.txt`/`.xls` gets a clean 415, not a downstream 4xx.
const CSV_MIME_TYPES = new Set(["text/csv", "application/csv"]);

/** Accept CSV-ish uploads only; reject anything else with a 415. */
function csvFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  const isCsv =
    CSV_MIME_TYPES.has(file.mimetype) || file.originalname.toLowerCase().endsWith(".csv");
  if (isCsv) {
    callback(null, true);
    return;
  }
  callback(new UnsupportedMediaTypeException("only CSV uploads are accepted"), false);
}

@Controller("accounts/:accountId/statements")
export class StatementsController {
  constructor(@Inject(StatementsService) private readonly statements: StatementsService) {}

  @Post()
  // `limits.fileSize` makes Multer abort mid-stream once the cap is exceeded, so a
  // huge upload is never fully buffered (the explicit `file.size` check below is
  // defense-in-depth, not the primary control).
  @UseInterceptors(
    FileInterceptor("file", {
      fileFilter: csvFileFilter,
      limits: { fileSize: MAX_FILE_BYTES, files: 1 },
    }),
  )
  async upload(
    @Param("accountId", new ZodValidationPipe(AccountIdSchema)) accountId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StatementIngestResponse> {
    if (file === undefined) {
      throw new BadRequestException("a CSV file is required in the 'file' field");
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new PayloadTooLargeException(`file exceeds the ${MAX_FILE_MB} MB limit`);
    }

    const body = StatementIngestResponseSchema.parse(await this.statements.ingest(accountId, file));
    response.status(body.statementId !== null ? HttpStatus.CREATED : HttpStatus.OK);
    return body;
  }
}
