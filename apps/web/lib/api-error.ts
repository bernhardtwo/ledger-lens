/**
 * Map a normalised {@link ApiError} to user-facing copy so every surface renders
 * failures identically (spec 0006 §5): ONE "API unreachable" pattern, the teachable
 * upload codes (413/415/422) read the same wherever they surface, and anything else
 * falls back to the caller's contextual title plus the API's own message.
 */
import type { ApiError } from "./api";

export interface ErrorCopy {
  readonly title: string;
  readonly detail: string;
}

export function describeApiError(error: ApiError, fallbackTitle: string): ErrorCopy {
  if (error.status === 0) {
    return {
      title: "API unreachable",
      detail: "The API isn't responding. Is it running on the configured API_BASE_URL?",
    };
  }
  if (error.code === "invalid-response") {
    return {
      title: "Unexpected response",
      detail: "The API replied in a shape the app didn't recognize.",
    };
  }
  if (error.status === 413) {
    return { title: "File too large", detail: "Statements must be 5 MB or smaller." };
  }
  if (error.status === 415) {
    return { title: "Unsupported file", detail: "Only CSV files are accepted." };
  }
  if (error.status === 422 && error.code === "unknown-profile") {
    return {
      title: "Unrecognized CSV format",
      detail: error.signature ? `Couldn't match these columns: ${error.signature}` : error.message,
    };
  }
  if (error.status === 422) {
    // currency-mismatch / too-many-rejected — the API message is already specific.
    return { title: "Couldn't process the file", detail: error.message };
  }
  return { title: fallbackTitle, detail: error.message };
}
