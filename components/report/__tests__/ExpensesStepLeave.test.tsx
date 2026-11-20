// The Expenses step's Save & Next / Save & Exit with an expense card open (plan item 3, 2026-11-20):
// nothing typed is lost. An open card holding input asks first - "You have an expense you haven't
// added yet." - Add it and continue runs the card's own Add (or Save, editing a line) and, once
// that line is saved, the step saves as usual; a refusal (missing fields, DUP1's 409) keeps the
// card and saves nothing. Leave it out drops the card and its auto-saved draft, then saves.
// Escape (or the backdrop) goes back: nothing saved, the card as typed. No card, or an untouched
// one, never asks.

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/apiClient", async (original) => ({
  ...(await original<typeof import("@/lib/apiClient")>()),
  pettyCashFetch: vi.fn(),
}));

const ENTITY = "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f";
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

import { ToastProvider } from "@/components/flask/Toasts";
import { ExpensesStep } from "@/components/report/ExpensesStep";
import { ApiError, pettyCashFetch } from "@/lib/apiClient";
import { pettyCashHome } from "@/lib/companyPages";
import type { ExpenseLine, ExpensesPage } from "@/lib/expenses";
import { stepHref } from "@/lib/wizardPages";

const fetchMock = vi.mocked(pettyCashFetch);
const DAY = "2026-11-16";
const SCOPE = { userId: "u-ann", entityId: ENTITY };
const QUESTION = "You have an expense you haven't added yet.";
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
const DUPLICATE = new ApiError(409, "This looks like a line you already added.", {
  error: "This looks like a line you already added.",
  duplicates: [{ id: "e2", description: "Copy paper", amount: "12.00", supplier: "Wellcome" }],
});

const expenses = (over: Partial<ExpensesPage> = {}): ExpensesPage => ({
  transaction_date: DAY,
  currency_code: "HKD",
  draft: {
    id: "r-1",
    status: "draft",
    current_section: "expenses",
    completed_sections: ["opening", "sales"],
    xero_integrated: false,
    publishing_status: "unpublished",
  },
  edit_version: 5,
  lines: [],
  total: 0,
  suppliers: [SUPPLIER],
  accounts: [ACCOUNT],
  permissions: { create_supplier: false },
  ...over,
});

type Call = { path: string; method: string; body: unknown };
let calls: Call[];

/** The page answers `page`; each add/edit answers the next of `lineSaves`; the step's PUT goes on. */
function expensesApi(page: ExpensesPage, ...lineSaves: unknown[]) {
  fetchMock.mockImplementation(
    async (p: string, init?: { method?: string; json?: unknown; form?: FormData }) => {
      const method = init?.method ?? "GET";
      calls.push({ path: p, method, body: init?.json ?? init?.form });
      if (p === "/reports/expenses" && method === "PUT") {
        const action = (init?.json as { action: string }).action;
        return {
          next: action === "exit" ? "dashboard" : "deposit",
          transaction_date: DAY,
        } as never;
      }
      if (p === "/reports/expenses") return page as never;
      if (p === "/reports/expenses/lines" || p.startsWith("/expense-lines/")) {
        const next = lineSaves.length > 1 ? lineSaves.shift() : lineSaves[0];
        if (next instanceof Error) throw next;
        return next as never;
      }
      throw new Error(`unexpected ${p}`);
    },
  );
}

const stepSaves = () => calls.filter((c) => c.path === "/reports/expenses" && c.method === "PUT");
const lineSends = () =>
  calls.filter((c) => c.path === "/reports/expenses/lines" || c.path.startsWith("/expense-lines/"));
const kept = (record: string) => window.localStorage.getItem(draftKey(SCOPE, "pc.expense", record));

let user: ReturnType<typeof userEvent.setup>;
const amount = () => screen.getByRole("textbox", { name: /Expense Amount/ });
const png = () => new File(["png"], "taxi.png", { type: "image/png" });
const question = () => screen.queryByRole("dialog", { name: QUESTION });

async function openCard() {
  await user.click(await screen.findByRole("button", { name: /Add New Expense/ }));
}

async function fillNewLine() {
  await openCard();
  await user.upload(screen.getByTestId("expense_files"), png());
  await user.type(amount(), "12");
  await user.click(screen.getByRole("combobox", { name: /Suppliers/ }));
  await user.click(screen.getByRole("option", { name: "Wellcome" }));
  await user.click(screen.getByRole("combobox", { name: /Account Code/ }));
  await user.click(screen.getByRole("option", { name: /General Expenses/ }));
}

function renderStep() {
  return render(
    <ToastProvider>
      <ExpensesStep day={DAY} />
    </ToastProvider>,
  );
}

function memoryFiles() {
  const all = new Map<string, File[]>();
  return {
    put: async (k: string, files: readonly File[]) => void all.set(k, [...files]),
    get: async (k: string) => all.get(k) ?? [],
    remove: async (k: string) => void all.delete(k),
    keys: async () => [...all.keys()],
  };
}

const DEPOSIT = stepHref(ENTITY, "DB Test Co", "deposit", DAY);
const HOME = pettyCashHome(ENTITY, "DB Test Co");

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
  calls = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("no question", () => {
  it("no card open: Save & Next saves the step at once", async () => {
    expensesApi(expenses({ lines: [LINE], total: 12 }));
    renderStep();
    await user.click(await screen.findByRole("button", { name: "Save & Next" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(DEPOSIT));
    expect(question()).toBeNull();
    expect(stepSaves()).toHaveLength(1);
    expect(stepSaves()[0].body).toEqual({ transaction_date: DAY, action: "next", edit_version: 5 });
  });

  it("a card open with nothing typed: Save & Exit saves at once", async () => {
    expensesApi(expenses());
    renderStep();
    await openCard();
    await user.click(screen.getByRole("button", { name: "Save & Exit" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(HOME));
    expect(question()).toBeNull();
    expect(stepSaves()).toHaveLength(1);
  });
});

describe("an open card holding input", () => {
  it("asks first; Escape goes back - nothing saved, the card as typed", async () => {
    expensesApi(expenses());
    renderStep();
    await openCard();
    await user.type(amount(), "12");
    await user.click(screen.getByRole("button", { name: "Save & Next" }));
    const dialog = await screen.findByRole("dialog", { name: QUESTION });
    expect(dialog).toHaveTextContent("Add it and continue");
    expect(dialog).toHaveTextContent("Leave it out");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(question()).toBeNull());
    expect(stepSaves()).toHaveLength(0);
    expect(lineSends()).toHaveLength(0);
    expect(router.push).not.toHaveBeenCalled();
    expect(amount()).toHaveValue("12.00");
  });

  it("Add it and continue adds the line, then saves the step with its action", async () => {
    expensesApi(expenses(), { line: { ...LINE, id: "new" }, total: 12 });
    renderStep();
    await fillNewLine();
    await user.click(screen.getByRole("button", { name: "Save & Next" }));
    await user.click(await screen.findByRole("button", { name: "Add it and continue" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(DEPOSIT));
    expect(lineSends()).toHaveLength(1);
    expect(lineSends()[0].method).toBe("POST");
    // the line first, then the step
    expect(calls.map((c) => `${c.method} ${c.path}`).slice(-2)).toEqual([
      "POST /reports/expenses/lines",
      "PUT /reports/expenses",
    ]);
    expect(stepSaves()[0].body).toMatchObject({ action: "next" });
    expect(kept(`new:${DAY}`)).toBeNull();
  });

  it("Add it and continue on Edit Expense saves the line's change, then the step (Save & Exit)", async () => {
    expensesApi(expenses({ lines: [LINE], total: 12 }), {
      line: { ...LINE, amount: 15 },
      total: 15,
    });
    renderStep();
    await user.click(await screen.findByRole("button", { name: "Edit expense" }));
    await user.clear(amount());
    await user.type(amount(), "15");
    await user.click(screen.getByRole("button", { name: "Save & Exit" }));
    await user.click(await screen.findByRole("button", { name: "Add it and continue" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(HOME));
    expect(lineSends().map((c) => `${c.method} ${c.path}`)).toEqual(["PATCH /expense-lines/l1"]);
    expect(stepSaves()[0].body).toMatchObject({ action: "exit" });
  });

  it("Add it and continue with fields missing stays on the card with its messages; the step is not saved", async () => {
    expensesApi(expenses());
    renderStep();
    await openCard();
    await user.type(amount(), "12");
    await user.click(screen.getByRole("button", { name: "Save & Next" }));
    await user.click(await screen.findByRole("button", { name: "Add it and continue" }));
    expect(await screen.findByText("Please fill out the Required Fields")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Suppliers/ })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(question()).toBeNull();
    expect(amount()).toHaveValue("12.00");
    expect(lineSends()).toHaveLength(0);
    expect(stepSaves()).toHaveLength(0);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("Add it and continue meeting DUP1's 409 shows the duplicate question; the step is not saved", async () => {
    expensesApi(expenses(), DUPLICATE, { line: { ...LINE, id: "new" }, total: 12 });
    renderStep();
    await fillNewLine();
    await user.click(screen.getByRole("button", { name: "Save & Next" }));
    await user.click(await screen.findByRole("button", { name: "Add it and continue" }));
    expect(await screen.findByRole("dialog", { name: "Save it anyway?" })).toBeInTheDocument();
    expect(stepSaves()).toHaveLength(0);
    // Save anyway adds the line and stays on the step; the person saves it themselves
    await user.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: /Expense Amount/ })).toBeNull(),
    );
    expect(stepSaves()).toHaveLength(0);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("Leave it out drops the card and its draft, then saves the step", async () => {
    expensesApi(expenses());
    renderStep();
    await fillNewLine();
    await act(() => vi.advanceTimersByTime(2000));
    expect(kept(`new:${DAY}`)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Save & Exit" }));
    await user.click(await screen.findByRole("button", { name: "Leave it out" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(HOME));
    expect(lineSends()).toHaveLength(0);
    expect(stepSaves()).toHaveLength(1);
    expect(stepSaves()[0].body).toMatchObject({ action: "exit" });
    expect(screen.queryByRole("textbox", { name: /Expense Amount/ })).toBeNull();
    expect(kept(`new:${DAY}`)).toBeNull();
  });
});
