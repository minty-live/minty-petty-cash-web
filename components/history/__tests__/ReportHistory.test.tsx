// Report history's "Publish failed" badge (components/history/ReportHistory.tsx). Its ⓘ used to open
// a dark "Publish issues:" popover; since the owner's H1 (2026-11-19) it links to the report's view
// at its History section (`.../summary#history`), where every attempt's issues are.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/apiClient", async (original) => ({
  ...(await original<typeof import("@/lib/apiClient")>()),
  pettyCashFetch: vi.fn(),
}));
vi.mock("@/lib/useAuth", () => ({
  useAuth: () => ({ entityId: "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f", entityName: "DB Test Co" }),
}));

import { ToastProvider } from "@/components/flask/Toasts";
import { ReportHistory } from "@/components/history/ReportHistory";
import { pettyCashFetch } from "@/lib/apiClient";
import type { HistoryPage, HistoryRow } from "@/lib/history";

const fetchMock = vi.mocked(pettyCashFetch);
const REPORTS = "/entity/360812e1/db-test-co/petty-cash/reports";

const row = (over: Partial<HistoryRow>): HistoryRow => ({
  id: "r-latest",
  transaction_date: "2026-11-18",
  status: "submitted",
  status_label: "Submitted",
  status_tone: "info",
  current_section: "submitted",
  total_sales: 0,
  total_expenses: 0,
  submitted_by: "Olive",
  published_by: null,
  submitted_at: "2026-11-18T10:00:00+08:00",
  published_at: null,
  created_at: "2026-11-18T09:00:00+08:00",
  was_published: false,
  xero_removable: false,
  permissions: { edit: false, delete: false, edit_details: false },
  ...over,
});

const PAGE: HistoryPage = {
  reports: [
    row({}),
    row({
      id: "r-failed",
      transaction_date: "2026-11-17",
      status_label: "Publish failed",
      status_tone: "danger",
      was_published: true,
    }),
  ],
  page: 1,
  per_page: 10,
  total_pages: 1,
  total_count: 2,
  latest_report_id: "r-latest",
  currency_code: "HKD",
  can_publish: true,
};

const show = async () => {
  fetchMock.mockResolvedValue(PAGE);
  render(
    <ToastProvider>
      <ReportHistory filters={{ start: "", end: "", page: "" }} />
    </ToastProvider>,
  );
  return screen.findByRole("link", { name: "See why it didn't publish" });
};

beforeEach(() => {
  router.push.mockClear();
  fetchMock.mockReset();
});

describe("a failed publish's ⓘ", () => {
  it("links to the report's History section, and only on the failed row", async () => {
    const link = await show();

    expect(link).toHaveAttribute("href", `${REPORTS}/r-failed/summary#history`);
    expect(screen.getAllByRole("link", { name: "See why it didn't publish" })).toHaveLength(1);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.queryByText("Publish issues:")).not.toBeInTheDocument();
  });

  it("goes there without a reload", async () => {
    const link = await show();

    await userEvent.click(link);

    expect(router.push).toHaveBeenCalledWith(`${REPORTS}/r-failed/summary#history`);
  });
});
