// Auto-saved drafts on the report wizard (owner's decisions doc L1; the user's choices, 2026-11-20):
// what a step holds is kept in this browser 2 s after the last change, put back as soon as the step
// opens again with nothing asked or drawn (the user, 2026-11-24), cleared by the step's own
// successful save and by the leave guard's Discard changes, KEPT through an R2 409, and dropped
// silently when the report's edit_version has moved since (stale).

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/apiClient", async (original) => ({
  ...(await original<typeof import("@/lib/apiClient")>()),
  pettyCashFetch: vi.fn(),
}));

const ENTITY = "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f";
const USER = "u-ann";
const auth = vi.hoisted(() => {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    user_id: "u-ann",
    entity_id: "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f",
  })}.sig`;
  return { token };
});
vi.mock("@/lib/useAuth", () => ({
  useAuth: () => ({ entityId: ENTITY, entityName: "DB Test Co" }),
}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getAuth: () => ({ token: auth.token, entityId: ENTITY, entityName: "DB Test Co" }),
}));

import { draftKey, resetDraftsForTests, setDraftFileStoreForTests } from "@minty/shared/drafts";
import { guardLeave } from "@minty/shared/leaveGuard";

import { ToastProvider } from "@/components/flask/Toasts";
import { CashCountStep } from "@/components/report/CashCountStep";
import { DepositStep } from "@/components/report/DepositStep";
import { ExpensesStep } from "@/components/report/ExpensesStep";
import { OpeningStep } from "@/components/report/OpeningStep";
import { SalesStep } from "@/components/report/SalesStep";
import { ApiError, pettyCashFetch } from "@/lib/apiClient";
import type { CashCountPage, DepositPage } from "@/lib/cash";
import type { ExpenseLine, ExpensesPage } from "@/lib/expenses";
import type { OpeningPage } from "@/lib/opening";
import type { SalesPage } from "@/lib/sales";

const fetchMock = vi.mocked(pettyCashFetch);
const DAY = "2026-11-16";
const SCOPE = { userId: USER, entityId: ENTITY };
const SAVED_BY = "This step was already saved by Sam Second at 14:05";
const DRAFT = {
  id: "r-1",
  status: "draft",
  current_section: "sales",
  completed_sections: ["opening"],
  xero_integrated: false,
  publishing_status: "unpublished",
};

const key = (form: string, record = DAY) => draftKey(SCOPE, form, record);
const kept = (form: string, record = DAY) => {
  const raw = window.localStorage.getItem(key(form, record));
  return raw ? (JSON.parse(raw) as { value: unknown; basedOn: string | null }) : null;
};

/** In place of IndexedDB (jsdom has none): the receipts a draft holds. */
function memoryFiles() {
  const all = new Map<string, File[]>();
  return {
    put: async (k: string, files: readonly File[]) => void all.set(k, [...files]),
    get: async (k: string) => all.get(k) ?? [],
    remove: async (k: string) => void all.delete(k),
    keys: async () => [...all.keys()],
  };
}

/** GETs of `path` answer `reads` in turn (the last repeats); a PUT answers `put` (an Error is thrown). */
function api(
  path: string,
  reads: unknown[],
  put: unknown = { next: "expenses", transaction_date: DAY },
) {
  let read = 0;
  fetchMock.mockImplementation(async (p: string, init?: { method?: string }) => {
    if (p !== path) throw new Error(`unexpected ${p}`);
    if (init?.method === "PUT") {
      if (put instanceof Error) throw put;
      return put as never;
    }
    const page = reads[Math.min(read, reads.length - 1)];
    read += 1;
    return page as never;
  });
}

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

let user: ReturnType<typeof userEvent.setup>;
const wait2s = () => act(() => vi.advanceTimersByTime(2000));
/** Nothing about a draft is drawn: no notice, no Restore / Discard (the user, 2026-11-24). */
function expectNothingDrawn() {
  expect(document.querySelector("[data-draft-notice]")).toBeNull();
  expect(screen.queryByText(/unsaved changes/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
}

function renderStep(step: ReactNode) {
  return render(<ToastProvider>{step}</ToastProvider>);
}

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  URL.createObjectURL ??= () => "blob:receipt";
  URL.revokeObjectURL ??= () => undefined;
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  window.localStorage.clear();
  resetDraftsForTests();
  setDraftFileStoreForTests(memoryFiles());
  fetchMock.mockReset();
  router.push.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Sales", () => {
  async function typeCash(text: string) {
    await user.type(await screen.findByRole("textbox", { name: "Cash Sales" }), text);
  }

  it("keeps what is typed 2 s after the last change, with the report's edit_version", async () => {
    api("/reports/sales", [sales()]);
    renderStep(<SalesStep day={DAY} />);
    await typeCash("50");
    expect(kept("pc.sales")).toBeNull();
    await wait2s();
    expect(kept("pc.sales")).toMatchObject({
      value: { values: { visa_sales: "" }, cash: "50" },
      basedOn: "3",
    });
  });

  it("puts the values back as soon as the step opens again, asking nothing", async () => {
    api("/reports/sales", [sales()]);
    const first = renderStep(<SalesStep day={DAY} />);
    await typeCash("50");
    await wait2s();
    first.unmount();

    renderStep(<SalesStep day={DAY} />);
    const cash = await screen.findByRole("textbox", { name: "Cash Sales" });
    await waitFor(() => expect(cash).toHaveValue("50"));
    expectNothingDrawn();
  });

  it("a successful save clears it before moving on", async () => {
    api("/reports/sales", [sales()]);
    renderStep(<SalesStep day={DAY} />);
    await typeCash("50");
    await wait2s();
    expect(kept("pc.sales")).not.toBeNull();
    router.push.mockImplementation(() => {
      // cleared BEFORE the page moves
      expect(kept("pc.sales")).toBeNull();
    });
    await user.click(screen.getByRole("button", { name: /Save & Next/ }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(kept("pc.sales")).toBeNull();
  });

  it("an R2 409 keeps it; after a reload it is stale and dropped silently", async () => {
    const saved = sales({ edit_version: 4, cash_sales: 20 });
    api(
      "/reports/sales",
      [sales(), saved],
      new ApiError(409, SAVED_BY, { error: SAVED_BY, saved, next: "expenses" }),
    );
    const first = renderStep(<SalesStep day={DAY} />);
    await typeCash("50");
    await wait2s();
    await user.click(screen.getByRole("button", { name: /Save & Next/ }));
    expect(await screen.findByText(SAVED_BY)).toBeInTheDocument();
    expect(kept("pc.sales")).toMatchObject({ value: { cash: "50" }, basedOn: "3" });
    first.unmount();

    renderStep(<SalesStep day={DAY} />);
    await screen.findByRole("textbox", { name: "Cash Sales" });
    await waitFor(() => expect(kept("pc.sales")).toBeNull());
    // their saved value stays in the field
    expect(screen.getByRole("textbox", { name: "Cash Sales" })).toHaveValue("20.00");
    expectNothingDrawn();
  });

  it("the leave guard's Discard changes clears it", async () => {
    api("/reports/sales", [sales()]);
    renderStep(<SalesStep day={DAY} />);
    await typeCash("50");
    await wait2s();
    const proceed = vi.fn();
    act(() => guardLeave(proceed));
    const leave = await screen.findByRole("dialog", { name: "Leave without saving?" });
    await user.click(within(leave).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(proceed).toHaveBeenCalled());
    expect(kept("pc.sales")).toBeNull();
  });
});

describe("Opening and Bank Deposit", () => {
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

  it("Opening before the day has a report is based on 'none': a report started since reads stale", async () => {
    api("/reports/opening", [opening()]);
    const first = renderStep(<OpeningStep day={DAY} />);
    await user.type(await screen.findByLabelText("Addition to Cash Drawer"), "30");
    await user.click(screen.getByRole("radio", { name: "Company Bank" }));
    await wait2s();
    expect(kept("pc.opening")).toMatchObject({
      value: { addition: "30.00", withdrawal: "company", withdrawalDirty: true },
      basedOn: "none",
    });
    first.unmount();

    // the same page again: put back at once
    const again = renderStep(<OpeningStep day={DAY} />);
    const addition = await screen.findByLabelText("Addition to Cash Drawer");
    await waitFor(() => expect(addition).toHaveValue("30.00"));
    expect(screen.getByRole("radio", { name: "Company Bank" })).toBeChecked();
    expectNothingDrawn();
    again.unmount();

    // someone started the day since
    api("/reports/opening", [
      opening({ draft: { ...DRAFT, current_section: "opening" }, edit_version: 1 }),
    ]);
    renderStep(<OpeningStep day={DAY} />);
    const stale = await screen.findByLabelText("Addition to Cash Drawer");
    await waitFor(() => expect(kept("pc.opening")).toBeNull());
    expect(stale).not.toHaveValue("30.00");
    expect(screen.getByRole("radio", { name: "Company Bank" })).not.toBeChecked();
    expectNothingDrawn();
  });

  it("Bank Deposit: kept, restored, and cleared by its save", async () => {
    const deposit: DepositPage = {
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
    };
    api("/reports/deposit", [deposit], { next: "cash_count", transaction_date: DAY });
    const first = renderStep(<DepositStep day={DAY} />);
    await user.type(await screen.findByLabelText("Deposit Amount"), "60");
    await wait2s();
    expect(kept("pc.deposit")).toMatchObject({ value: { amount: "60" }, basedOn: "7" });
    first.unmount();

    renderStep(<DepositStep day={DAY} />);
    const amount = await screen.findByLabelText("Deposit Amount");
    await waitFor(() => expect(amount).toHaveValue("60"));
    expectNothingDrawn();
    await user.click(screen.getByRole("button", { name: /Save & Next/ }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(kept("pc.deposit")).toBeNull();
  });
});

describe("Cash Count", () => {
  const page: CashCountPage = {
    transaction_date: DAY,
    currency_code: "HKD",
    draft: { ...DRAFT, current_section: "cash_count" },
    edit_version: 9,
    opening_balance: 100,
    cash_addition: 0,
    cash_sales: 0,
    expenses: 0,
    bank_deposit: 0,
    cash_on_hand: 100,
    expected_cash: 100,
    denominations: [
      { id: "n100", value: 100, kind: "note", name: null, count: 0 },
      { id: "n50", value: 50, kind: "note", name: null, count: 0 },
    ],
    safe_box_balance: 0,
    discrepancy: { amount: 0, kind: "none", reason: "" },
  };

  it("keeps the open calculator's typed counts; coming back reopens it with them", async () => {
    api("/reports/cash-count", [page]);
    const first = renderStep(<CashCountStep day={DAY} />);
    await user.click(await screen.findByRole("button", { name: "Calculator" }));
    const calc = screen.getByRole("dialog", { name: "Use Calculator" });
    await user.type(within(calc).getAllByRole("textbox")[1], "3");
    await wait2s();
    expect(kept("pc.cash-count")).toMatchObject({
      value: { calculator: true, typed: { n100: "", n50: "3" }, counts: { n100: 0, n50: 0 } },
      basedOn: "9",
    });
    first.unmount();

    renderStep(<CashCountStep day={DAY} />);
    const reopened = await screen.findByRole("dialog", { name: "Use Calculator" });
    expect(within(reopened).getAllByRole("textbox")[1]).toHaveValue("3");
    expectNothingDrawn();
  });

  it("keeps a typed safebox and reason; a moved edit_version drops it silently", async () => {
    api("/reports/cash-count", [page]);
    const first = renderStep(<CashCountStep day={DAY} />);
    await user.type(await screen.findByRole("textbox", { name: "Safebox Cash Balance" }), "20");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Short by a note");
    await wait2s();
    expect(kept("pc.cash-count")).toMatchObject({
      value: { safe: "20.00", reason: "Short by a note", calculator: false, typed: null },
    });
    first.unmount();

    api("/reports/cash-count", [{ ...page, edit_version: 10 }]);
    renderStep(<CashCountStep day={DAY} />);
    const safe = await screen.findByRole("textbox", { name: "Safebox Cash Balance" });
    await waitFor(() => expect(kept("pc.cash-count")).toBeNull());
    expect(safe).not.toHaveValue("20.00");
    expect(screen.queryByDisplayValue("Short by a note")).toBeNull();
    expectNothingDrawn();
  });
});

describe("Expenses", () => {
  const SUPPLIER = { id: "s-well", name: "Wellcome" };
  const ACCOUNT = { id: "a-429", code: "429", name: "General Expenses" };
  const LINE: ExpenseLine = {
    id: "l1",
    item: "General Expenses",
    amount: 12,
    description: "Milk",
    supplier: SUPPLIER,
    account: ACCOUNT,
    receipts: [{ id: "r1", name: "milk.png", mime_type: "image/png" }],
  };
  const expenses = (over: Partial<ExpensesPage> = {}): ExpensesPage => ({
    transaction_date: DAY,
    currency_code: "HKD",
    draft: { ...DRAFT, current_section: "expenses" },
    edit_version: 5,
    lines: [],
    total: 0,
    suppliers: [SUPPLIER],
    accounts: [ACCOUNT],
    permissions: { create_supplier: false },
    ...over,
  });
  const DUPLICATE = new ApiError(409, "This looks like a line you already added.", {
    error: "This looks like a line you already added.",
    duplicates: [{ id: "e2", description: "Copy paper", amount: "12.00", supplier: "Wellcome" }],
  });

  /** The expenses read answers `reads`; each add/edit answers the next of `saves`. */
  function expensesApi(reads: ExpensesPage[], ...saves: unknown[]) {
    let read = 0;
    fetchMock.mockImplementation(async (p: string) => {
      if (p === "/reports/expenses") {
        const answer = reads[Math.min(read, reads.length - 1)];
        read += 1;
        return answer as never;
      }
      if (p === "/reports/expenses/lines" || p.startsWith("/expense-lines/")) {
        const next = saves.length > 1 ? saves.shift() : saves[0];
        if (next instanceof Error) throw next;
        return next as never;
      }
      throw new Error(`unexpected ${p}`);
    });
  }

  const amount = () => screen.getByRole("textbox", { name: /Expense Amount/ });
  const png = () => new File(["png"], "taxi.png", { type: "image/png" });

  async function fillNewLine() {
    await user.click(await screen.findByRole("button", { name: /Add New Expense/ }));
    await user.upload(screen.getByTestId("expense_files"), png());
    await user.type(amount(), "12");
    await user.click(screen.getByRole("combobox", { name: /Suppliers/ }));
    await user.click(screen.getByRole("option", { name: "Wellcome" }));
    await user.click(screen.getByRole("combobox", { name: /Account Code/ }));
    await user.click(screen.getByRole("option", { name: /General Expenses/ }));
  }

  it("keeps a new line with its receipt; coming back opens the card with both", async () => {
    expensesApi([expenses()]);
    const first = renderStep(<ExpensesStep day={DAY} />);
    await fillNewLine();
    await wait2s();
    expect(kept("pc.expense", `new:${DAY}`)).toMatchObject({
      value: {
        values: { amount: "12.00", supplierText: "Wellcome", accountText: "General Expenses" },
      },
      basedOn: null,
    });
    first.unmount();

    renderStep(<ExpensesStep day={DAY} />);
    expect(await screen.findByRole("textbox", { name: /Expense Amount/ })).toHaveValue("12.00");
    expectNothingDrawn();
    expect(screen.getByRole("combobox", { name: /Suppliers/ })).toHaveValue("Wellcome");
    // the receipt came back from the draft's file store
    expect(screen.getByRole("img", { name: "Uploaded receipt" })).toBeInTheDocument();
  });

  it("keeps it through DUP1's 409 until the line is added, then clears it", async () => {
    expensesApi([expenses()], DUPLICATE, { line: { ...LINE, id: "new" }, total: 12 });
    renderStep(<ExpensesStep day={DAY} />);
    await fillNewLine();
    await wait2s();
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("dialog", { name: "Save it anyway?" })).toBeInTheDocument();
    expect(kept("pc.expense", `new:${DAY}`)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: /Expense Amount/ })).toBeNull(),
    );
    expect(kept("pc.expense", `new:${DAY}`)).toBeNull();
  });

  it("an edited line's draft is based on the line: changed since, it reads stale", async () => {
    expensesApi([expenses({ lines: [LINE], total: 12 })]);
    const first = renderStep(<ExpensesStep day={DAY} />);
    await user.click(await screen.findByRole("button", { name: "Edit expense" }));
    await user.clear(amount());
    await user.type(amount(), "15");
    await wait2s();
    expect(kept("pc.expense", "l1")).toMatchObject({ value: { values: { amount: "15" } } });
    first.unmount();

    // unchanged: Edit Expense opens with it on arrival
    const again = renderStep(<ExpensesStep day={DAY} />);
    expect(await screen.findByRole("heading", { name: "Edit Expense" })).toBeInTheDocument();
    expect(amount()).toHaveValue("15");
    expectNothingDrawn();
    again.unmount();

    // changed by someone since: dropped silently, never put back
    expensesApi([expenses({ lines: [{ ...LINE, amount: 13 }], total: 13 })]);
    renderStep(<ExpensesStep day={DAY} />);
    expect(await screen.findByRole("button", { name: "Edit expense" })).toBeInTheDocument();
    await waitFor(() => expect(kept("pc.expense", "l1")).toBeNull());
    expect(screen.queryByRole("heading", { name: "Edit Expense" })).toBeNull();
    expectNothingDrawn();
  });

  it("a successful edit clears it", async () => {
    expensesApi([expenses({ lines: [LINE], total: 12 })], {
      line: { ...LINE, amount: 15 },
      total: 15,
    });
    renderStep(<ExpensesStep day={DAY} />);
    await user.click(await screen.findByRole("button", { name: "Edit expense" }));
    await user.clear(amount());
    await user.type(amount(), "15");
    await wait2s();
    expect(kept("pc.expense", "l1")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit Expense" })).toBeNull());
    expect(kept("pc.expense", "l1")).toBeNull();
  });
});
