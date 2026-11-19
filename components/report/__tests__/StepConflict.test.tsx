// Two people on one report (owner's decisions doc R1/R2, 2026-11-19): every step's save carries the
// `edit_version` it was read at; R2's 409 shows who saved it and the saved values, then Continue goes
// to the next step; R1's 409 on Opening says the day was started and takes the person to that report.

import { render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getAuth: () => ({ entityId: "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f", entityName: "DB Test Co" }),
}));

import { ToastProvider } from "@/components/flask/Toasts";
import { DepositStep } from "@/components/report/DepositStep";
import { OpeningStep } from "@/components/report/OpeningStep";
import { SalesStep } from "@/components/report/SalesStep";
import { ApiError, pettyCashFetch } from "@/lib/apiClient";
import type { DepositPage } from "@/lib/cash";
import type { OpeningPage } from "@/lib/opening";
import type { SalesPage } from "@/lib/sales";

const fetchMock = vi.mocked(pettyCashFetch);
const DAY = "2026-11-16";
const SAVED_BY = "This step was already saved by Sam Second at 14:05";
const STARTED = "A report for this date has already been started";
const DRAFT = {
  id: "r-1",
  status: "draft",
  current_section: "sales",
  completed_sections: ["opening"],
  xero_integrated: false,
  publishing_status: "unpublished",
};

const opening = (over: Partial<OpeningPage> = {}): OpeningPage => ({
  transaction_date: DAY,
  currency_code: "HKD",
  draft: null,
  edit_version: null,
  starting_cash_balance: 100,
  yesterday_closing_balance: 100,
  safebox_balance: 0,
  cash_addition: null,
  withdrawal: "personal",
  ...over,
});

const sales = (over: Partial<SalesPage> = {}): SalesPage => ({
  transaction_date: DAY,
  currency_code: "HKD",
  draft: DRAFT,
  edit_version: 3,
  methods: [
    { sale_id: "v", name: "Visa", value_name: "visa_sales", type: "electronic", amount: null },
  ],
  cash_sales: null,
  groups: "electronic_delivery",
  ...over,
});

const deposit = (over: Partial<DepositPage> = {}): DepositPage => ({
  transaction_date: DAY,
  currency_code: "HKD",
  draft: { ...DRAFT, current_section: "deposit" },
  edit_version: 7,
  opening_balance: 100,
  cash_addition: 0,
  cash_sales: 50,
  expenses: 0,
  bank_deposit: 0,
  cash_on_hand: 150,
  expected_cash: 150,
  ...over,
});

/** `reads` answer each GET in turn (the last one repeats); `refusal` answers the PUT. */
function answer(path: string, reads: unknown[], refusal: ApiError) {
  let read = 0;
  fetchMock.mockImplementation(async (p: string, init?: { method?: string }) => {
    if (p !== path) throw new Error(`unexpected ${p}`);
    if (init?.method === "PUT") throw refusal;
    const page = reads[Math.min(read, reads.length - 1)];
    read += 1;
    return page as never;
  });
}

/** The dialog's saved value under `label` (the text as written, its non-breaking space kept). */
function savedValue(label: string) {
  const term = within(screen.getByRole("dialog")).getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent;
}

function saveBody() {
  const save = fetchMock.mock.calls.find(([, init]) => (init as { method?: string })?.method);
  return (save?.[1] as { json: Record<string, unknown> }).json;
}

beforeEach(() => {
  fetchMock.mockReset();
  router.push.mockReset();
});

describe("Opening", () => {
  it("R2: sends the version it read; shows who saved it and what, and Continue goes on", async () => {
    const page = opening({ draft: DRAFT, edit_version: 2, cash_addition: 30 });
    const saved = { ...page, edit_version: 3, cash_addition: 45, withdrawal: "company" as const };
    answer(
      "/reports/opening",
      [page],
      new ApiError(409, SAVED_BY, { error: SAVED_BY, saved, next: "sales" }),
    );
    render(
      <ToastProvider>
        <OpeningStep day={DAY} />
      </ToastProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Save & Next/ }));

    expect(saveBody()).toMatchObject({ edit_version: 2 });
    expect(await screen.findByText(SAVED_BY)).toBeInTheDocument();
    expect(savedValue("Withdrawal from")).toBe("Company Bank");
    expect(savedValue("Addition to Cash Drawer")).toBe("HKD\u00a045.00");
    expect(router.push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(router.push).toHaveBeenCalledWith(
      expect.stringContaining(`/petty-cash/reports/new/sale?transaction_date=${DAY}`),
    );
  });

  it("R1: a page read before the day had a report sends null; it is told and taken to that report", async () => {
    answer(
      "/reports/opening",
      [opening()],
      new ApiError(409, STARTED, { error: STARTED, report_id: "r-1", to: "sales" }),
    );
    render(
      <ToastProvider>
        <OpeningStep day={DAY} />
      </ToastProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Save & Next/ }));

    expect(saveBody()).toMatchObject({ edit_version: null });
    expect(await screen.findByText(STARTED)).toBeInTheDocument();
    expect(router.push).toHaveBeenCalledWith(
      expect.stringContaining(`/petty-cash/reports/new/sale?transaction_date=${DAY}`),
    );
  });

  it("R1 on a report still on Opening: reads the day again and shows that report", async () => {
    const theirs = opening({
      draft: { ...DRAFT, current_section: "opening" },
      edit_version: 1,
      cash_addition: 25,
    });
    answer(
      "/reports/opening",
      [opening(), theirs],
      new ApiError(409, STARTED, { error: STARTED, report_id: "r-1", to: "opening" }),
    );
    render(
      <ToastProvider>
        <OpeningStep day={DAY} />
      </ToastProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Save & Next/ }));

    expect(await screen.findByText(STARTED)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Addition to Cash Drawer")).toHaveValue("25.00"),
    );
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("Sales and Bank Deposit", () => {
  it("Sales: sends the version; R2 shows the saved amounts and goes on to Expenses", async () => {
    const saved = sales({
      edit_version: 4,
      methods: [{ ...sales().methods[0], amount: 80 }],
      cash_sales: 20,
    });
    answer(
      "/reports/sales",
      [sales()],
      new ApiError(409, SAVED_BY, { error: SAVED_BY, saved, next: "expenses" }),
    );
    render(
      <ToastProvider>
        <SalesStep day={DAY} />
      </ToastProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Save & Next/ }));

    expect(saveBody()).toMatchObject({ edit_version: 3 });
    expect(await screen.findByText(SAVED_BY)).toBeInTheDocument();
    expect(savedValue("Visa")).toBe("HKD\u00a080.00");
    expect(savedValue("Cash Sales")).toBe("HKD\u00a020.00");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(router.push).toHaveBeenCalledWith(
      expect.stringContaining(`/petty-cash/reports/new/expense?transaction_date=${DAY}`),
    );
  });

  it("Bank Deposit: sends the version; R2 goes on to Cash Count", async () => {
    const saved = deposit({ edit_version: 8, bank_deposit: 60 });
    answer(
      "/reports/deposit",
      [deposit()],
      new ApiError(409, SAVED_BY, { error: SAVED_BY, saved, next: "cash_count" }),
    );
    render(
      <ToastProvider>
        <DepositStep day={DAY} />
      </ToastProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Save & Next/ }));

    expect(saveBody()).toMatchObject({ edit_version: 7 });
    expect(await screen.findByText(SAVED_BY)).toBeInTheDocument();
    expect(savedValue("Bank Deposit")).toBe("HKD\u00a060.00");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(router.push).toHaveBeenCalledWith(
      expect.stringContaining(`/petty-cash/reports/new/cash-count?transaction_date=${DAY}`),
    );
  });
});
