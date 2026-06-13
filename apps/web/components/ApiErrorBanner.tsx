import type { ApiError } from "../lib/api";
import { describeApiError } from "../lib/api-error";
import { ErrorBanner } from "./ErrorBanner";

/**
 * The single error-banner pattern for the data surfaces (picker, upload, table,
 * categorize): map an {@link ApiError} to consistent copy via {@link describeApiError}.
 * `fallbackTitle` is the surface's context for failures that aren't a recognised code.
 */
export function ApiErrorBanner({
  error,
  fallbackTitle,
  className,
}: {
  error: ApiError;
  fallbackTitle: string;
  className?: string;
}) {
  const { title, detail } = describeApiError(error, fallbackTitle);
  return (
    <ErrorBanner title={title} className={className}>
      {detail}
    </ErrorBanner>
  );
}
