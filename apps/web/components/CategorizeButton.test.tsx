import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategorizeButton } from "./CategorizeButton";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function res(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe("CategorizeButton", () => {
  it("reports before/after counts and notifies the parent", async () => {
    fetchMock.mockResolvedValueOnce(
      res({ totalUncategorized: 10, categorized: 7, uncategorized: 2, failed: 1 }),
    );
    const onCategorized = vi.fn();
    render(<CategorizeButton accountId="a" onCategorized={onCategorized} />);
    fireEvent.click(screen.getByText("Categorize uncategorized"));

    expect(
      await screen.findByText((c) => c.includes("7 categorized") && c.includes("of 10 pending")),
    ).toBeInTheDocument();
    expect(onCategorized).toHaveBeenCalledOnce();
  });

  it("reports when nothing is pending", async () => {
    fetchMock.mockResolvedValueOnce(
      res({ totalUncategorized: 0, categorized: 0, uncategorized: 0, failed: 0 }),
    );
    render(<CategorizeButton accountId="a" onCategorized={vi.fn()} />);
    fireEvent.click(screen.getByText("Categorize uncategorized"));
    expect(await screen.findByText("Everything is already categorized.")).toBeInTheDocument();
  });
});
