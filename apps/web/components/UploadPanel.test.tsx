import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadPanel } from "./UploadPanel";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function res(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function selectAndSubmit(): void {
  const file = new File(["date,description,amount\n2026-05-02,WHOLE FOODS,12.50"], "stmt.csv", {
    type: "text/csv",
  });
  fireEvent.change(screen.getByLabelText("CSV statement"), { target: { files: [file] } });
  fireEvent.click(screen.getByText("Upload CSV"));
}

describe("UploadPanel", () => {
  it("shows inserted/skipped + a rejected list on a created import", async () => {
    fetchMock.mockResolvedValueOnce(
      res({
        statementId: "33333333-3333-4333-8333-333333333333",
        profileId: "p",
        inserted: 5,
        skipped: 1,
        rejected: [{ row: 3, reason: "bad date" }],
      }),
    );
    const onUploaded = vi.fn();
    render(<UploadPanel accountId="a" onUploaded={onUploaded} />);
    selectAndSubmit();

    expect(await screen.findByText("Statement imported")).toBeInTheDocument();
    expect(screen.getByText(/5 inserted/)).toBeInTheDocument();
    expect(screen.getByText(/1 skipped/)).toBeInTheDocument();
    expect(screen.getByText("Rejected rows (1)")).toBeInTheDocument();
    expect(screen.getByText(/Row 3: bad date/)).toBeInTheDocument();
    expect(onUploaded).toHaveBeenCalledOnce();
  });

  it("distinguishes an idempotent no-op (statementId null)", async () => {
    fetchMock.mockResolvedValueOnce(
      res({ statementId: null, profileId: "p", inserted: 0, skipped: 4, rejected: [] }),
    );
    render(<UploadPanel accountId="a" onUploaded={vi.fn()} />);
    selectAndSubmit();
    expect(await screen.findByText("Already imported — no new rows")).toBeInTheDocument();
  });

  it.each<{ status: number; body: Record<string, unknown>; title: string; detail?: string }>([
    { status: 413, body: { error: "file-too-large", message: "too big" }, title: "File too large" },
    { status: 415, body: { statusCode: 415, message: "no" }, title: "Unsupported file" },
    {
      status: 422,
      body: { error: "unknown-profile", message: "unknown", signature: "date,desc,amt" },
      title: "Unrecognized CSV format",
      detail: "date,desc,amt",
    },
    {
      status: 422,
      body: {
        error: "currency-mismatch",
        message: "file currency EUR does not match account currency USD",
      },
      title: "Couldn't process the file",
      detail: "EUR does not match",
    },
  ])("maps a $status error to '$title'", async ({ status, body, title, detail }) => {
    fetchMock.mockResolvedValueOnce(res(body, false, status));
    const onUploaded = vi.fn();
    render(<UploadPanel accountId="a" onUploaded={onUploaded} />);
    selectAndSubmit();

    expect(await screen.findByText(title)).toBeInTheDocument();
    if (detail !== undefined) {
      expect(screen.getByText(detail, { exact: false })).toBeInTheDocument();
    }
    expect(onUploaded).not.toHaveBeenCalled();
  });
});
