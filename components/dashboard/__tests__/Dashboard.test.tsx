// The dashboard's day summary (components/dashboard/Dashboard.tsx).
//
// 2026-11-03 walk: once today's report was submitted the dashboard said "Today's report is
// submitted" and, right under it, "Report in Progress" - nothing was in progress. The summary
// names the last submitted report then.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/lib/apiClient", async (original) => ({
  ...(await original<typeof import("@/lib/apiClient")>()),
  pettyCashFetch: vi.fn(),
}));
vi.mock("@/lib/useAuth", () => ({
  useAuth: () => ({ entityId: "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f", entityName: "DB Test Co" }),
}));

import { Dashboard } from "@/components/dashboard/Dashboard";
import { ToastProvider } from "@/components/flask/Toasts";
import { pettyCashFetch } from "@/lib/apiClient";
import type { Home } from "@/lib/dashboard";

const fetchMock = vi.mocked(pettyCashFetch);

const day = (closing: number) => ({
  id: `r-${closing}`,
  closing_balance: closing,
  bank_deposit: 0,
  xero_integrated: false,
  submitter_first_name: "Angelika",
});

const home = (overrides: Partial<Home>): Home => ({
  server_today: "2026-11-03",
  user_count: 1,
  currency_code: "HKD",
  latest: {
    date: "2026-11-03",
    closing_balance: 950,
    deposit: 0,
    deposit_bank_name: "",
    deposit_bank_number: "",
    deposit_correction_missing_settings: [],
    can_correct_deposit: false,
    submitter_first_name: "Angelika",
  },
  draft: null,
  draft_date: null,
  start_date: "2026-11-02",
  published: { "2026-11-02": day(1000), "2026-11-03": day(950) },
  today_has_report: true,
  today_is_latest_report: true,
  xero_settings: { complete: true, missing: [] },
  permissions: { read_only: false, correct_deposit: false },
  ...overrides,
});

const show = (answer: Home) => {
  fetchMock.mockResolvedValue(answer);
  render(
    <ToastProvider>
      <Dashboard />
    </ToastProvider>,
  );
};

beforeEach(() => sessionStorage.clear());

describe("the day summary", () => {
  it("names the last submitted report once today's is in, not a report in progress", async () => {
    show(home({}));

    expect(await screen.findByText("Today's report is submitted")).toBeInTheDocument();
    expect(screen.getByText("Last Submitted Report")).toBeInTheDocument();
    expect(screen.queryByText("Report in Progress")).not.toBeInTheDocument();
  });

  it("still says Report in Progress before today's is in", async () => {
    show(
      home({
        latest: { ...home({}).latest, date: "2026-11-02", closing_balance: 1000 },
        published: { "2026-11-02": day(1000) },
        today_has_report: false,
        today_is_latest_report: false,
      }),
    );

    expect(await screen.findByText("Report in Progress")).toBeInTheDocument();
    expect(screen.queryByText("Today's report is submitted")).not.toBeInTheDocument();
  });
});

// Owner, 2026-11-18: the calendar opened on today's month even when the draft Continue Report
// resumes is in an earlier one; it opens on the draft's day, as Start New Report's catch-up day does.
describe("the report calendar", () => {
  const behind = {
    latest: { ...home({}).latest, date: "2026-10-30", closing_balance: 1000 },
    published: { "2026-10-30": day(1000) },
    start_date: "2026-10-30",
    today_has_report: false,
    today_is_latest_report: false,
  };

  it("opens on the month of the draft Continue Report resumes", async () => {
    show(
      home({
        ...behind,
        draft: { id: "d", current_section: null, completed_sections: [], last_edit_seconds: 60 },
        draft_date: "2026-10-31",
      }),
    );

    expect(await screen.findByText("Continue Report")).toBeInTheDocument();
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    expect(screen.queryByText("November 2026")).not.toBeInTheDocument();
  });

  it("opens on today's month with no draft and nothing to catch up", async () => {
    show(home({}));

    expect(await screen.findByText("November 2026")).toBeInTheDocument();
  });
});

// 2026-11-23: after "Continue to next day report" the dashboard was on the right day (the one after
// the last submitted report) and still warned "Earlier reports need finishing before this one".
describe("the catch-up warning", () => {
  const WARNING = "Earlier reports need finishing before today's. Want to catch those up first?";
  const ANY_WARNING = /Earlier reports need finishing/;
  const behind = {
    server_today: "2026-11-23",
    latest: { ...home({}).latest, date: "2026-10-03", closing_balance: 27000 },
    published: { "2026-10-01": day(27000), "2026-10-02": day(27001), "2026-10-03": day(27002) },
    start_date: "2026-10-01",
    today_has_report: false,
    today_is_latest_report: false,
  };

  it("is not shown on the day that catches up", async () => {
    show(home(behind));

    expect(await screen.findByText("Start New Report")).toBeInTheDocument();
    expect(screen.queryByText(ANY_WARNING)).not.toBeInTheDocument();
  });

  it("is not shown while that day's draft is open", async () => {
    show(
      home({
        ...behind,
        draft: { id: "d", current_section: null, completed_sections: [], last_edit_seconds: 60 },
        draft_date: "2026-10-04",
      }),
    );

    expect(await screen.findByText("Continue Report")).toBeInTheDocument();
    expect(screen.queryByText(ANY_WARNING)).not.toBeInTheDocument();
  });

  it("is shown, about today's report, when an earlier submitted day is picked", async () => {
    show(home(behind));

    fireEvent.click(await screen.findByRole("button", { name: "02 Oct 2026, submitted" }));
    expect(screen.getByText(WARNING)).toBeInTheDocument();
  });
});
