// The receipt reader inside Add New Expense (components/report/AddExpenseCard.tsx +
// ReceiptReader.tsx), with the Petty Cash API stubbed: a picked receipt is read, suggestions fill
// only empty fields, and nothing is sent until Add. The rules themselves: lib/__tests__/expenseAi.test.ts.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async (original) => ({
  ...(await original<typeof import("@/lib/apiClient")>()),
  pettyCashFetch: vi.fn(),
}));

import { ToastProvider } from "@/components/flask/Toasts";
import { AddExpenseCard, type AddExpenseProps } from "@/components/report/AddExpenseCard";
import { pettyCashFetch } from "@/lib/apiClient";
import { resetReaderLatch } from "@/lib/expenseAi";

const fetchMock = vi.mocked(pettyCashFetch);

const SUPPLIERS = [
  { id: "s-well", name: "Wellcome" },
  { id: "s-park", name: "ParknShop" },
];
const ACCOUNTS = [
  { id: "a-429", code: "429", name: "General Expenses" },
  { id: "a-461", code: "461", name: "Printing & Stationery" },
];

const SUGGESTIONS = {
  amount: { value: "48.80", confidence: 0.97, band: "high", applied: true },
  description: { value: "Copy paper", confidence: 0.9, band: "high", applied: true },
  supplier: {
    value: "Wellcome",
    confidence: 0.93,
    band: "high",
    applied: true,
    contact_id: "s-well",
  },
  account: {
    value: "461 Printing & Stationery",
    confidence: 0.7,
    band: "medium",
    applied: true,
    account_id: "a-461",
    code: "461",
    name: "Printing & Stationery",
  },
};

type Answer = unknown | (() => Promise<unknown>);

/** The API: the extract route answers `extract` (each call the next one), and Add answers a line. */
function api(...extract: Answer[]) {
  const reads: FormData[] = [];
  const adds: FormData[] = [];
  const suppliers: unknown[] = [];
  const edits: { path: string; form: FormData; method?: string }[] = [];
  fetchMock.mockImplementation(async (path, init) => {
    if (path === "/reports/expenses/extract") {
      reads.push(init?.form as FormData);
      const next = extract.length > 1 ? extract.shift() : extract[0];
      return typeof next === "function" ? (next as () => Promise<unknown>)() : next;
    }
    if (path === "/reports/expenses/lines") {
      adds.push(init?.form as FormData);
      return { line: { id: "new" }, total: 48.8 };
    }
    if (path.startsWith("/expense-lines/")) {
      edits.push({ path, form: init?.form as FormData, method: init?.method });
      return { line: { id: "l1" }, total: 99.9 };
    }
    if (path === "/suppliers") {
      suppliers.push(init?.json);
      return { id: "s-new", name: "x" };
    }
    throw new Error(`unexpected ${path}`);
  });
  return { reads, adds, suppliers, edits };
}

/** The company's AI reads (owner, 2026-11-18): one allowance with Payment Request. */
const OPEN = {
  enabled: true,
  reads_used: null,
  reads_limit: null,
  reads_left: null,
  percent_left: 80,
  blocked: false,
  resumes_at: null,
};

function show(over: Partial<AddExpenseProps> = {}) {
  const props: AddExpenseProps = {
    day: "2026-10-13",
    code: "HKD",
    suppliers: SUPPLIERS,
    accounts: ACCOUNTS,
    canCreateSupplier: true,
    reader: OPEN,
    onReaderStatus: vi.fn(),
    onSupplierCreated: vi.fn(),
    onAdded: vi.fn(),
    onSaved: vi.fn(),
    onCancel: vi.fn(),
    setBusy: vi.fn(),
    onNoDraft: vi.fn(),
    ...over,
  };
  render(
    <ToastProvider>
      <AddExpenseCard {...props} />
    </ToastProvider>,
  );
  return props;
}

const png = (name = "taxi.png") => new File(["png"], name, { type: "image/png" });
const attach = (file: File) => userEvent.upload(screen.getByTestId("expense_files"), file);
/** Picks a receipt and presses "Read receipt" (the only way it is read, owner 2026-11-18). */
async function attachAndRead(file: File) {
  await attach(file);
  await userEvent.click(screen.getByRole("button", { name: "Read receipt" }));
}
const amount = () => screen.getByRole("textbox", { name: /Expense Amount/ });
const description = () => screen.getByRole("textbox", { name: "Description" });
const supplier = () => screen.getByRole("combobox", { name: /Suppliers/ });
const account = () => screen.getByRole("combobox", { name: /Account Code/ });

beforeAll(() => {
  // jsdom has neither; the card scrolls itself into view and previews the picked file
  Element.prototype.scrollIntoView ??= () => undefined;
  URL.createObjectURL ??= () => "blob:receipt";
  URL.revokeObjectURL ??= () => undefined;
});
beforeEach(() => resetReaderLatch());
afterEach(() => resetReaderLatch());

/** The reader switched off (the API without EXPENSE_AI_ENABLED). */
const READER_OFF_ANSWER = { suggestions: null, reason: "disabled" };

// Owner, 2026-11-04: a started read that fails says so in one quiet line (it used to say nothing).
const FAILED = "I couldn't read this receipt. Enter the details yourself.";

describe("the company's AI allowance beside Read receipt", () => {
  it("shows how much of the allowance is left beside the button", async () => {
    api({ suggestions: SUGGESTIONS, reason: null });
    show();
    await attach(png());
    const button = screen.getByRole("button", { name: "Read receipt" });
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleDescription("80% of your AI allowance left");
  });

  it("used up: the button is disabled with the reason beside it, and nothing is read", async () => {
    const calls = api({ suggestions: SUGGESTIONS, reason: null });
    show({ reader: { ...OPEN, percent_left: 0, blocked: true } });
    await attach(png());
    const button = screen.getByRole("button", { name: "Read receipt" });
    expect(button).toBeDisabled();
    expect(
      screen.getByText("Your company has used its AI allowance. Fill in the details yourself."),
    ).toBeInTheDocument();
    await userEvent.click(button);
    expect(calls.reads).toHaveLength(0);
  });

  it("hands each read's new allowance to the page, and a used-up answer is not a failure", async () => {
    const after = { ...OPEN, percent_left: 0, blocked: true };
    api({ suggestions: null, reason: "limit_reached", reader: after });
    const props = show();
    await attachAndRead(png());
    await waitFor(() => expect(props.onReaderStatus).toHaveBeenCalledWith(after));
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});

describe("the receipt reader in Add New Expense", () => {
  // Owner, 2026-11-18: a receipt is read only when the person presses "Read receipt".
  it("picking a receipt reads nothing; the button offers it, and pressing it reads once", async () => {
    const calls = api({ suggestions: SUGGESTIONS, reason: null });
    show();
    await attach(png());
    const button = screen.getByRole("button", { name: "Read receipt" });
    expect(button).toHaveAttribute("type", "button");
    expect(calls.reads).toHaveLength(0);
    expect(amount()).toHaveValue("");
    await userEvent.click(button);
    await waitFor(() => expect(amount()).toHaveValue("48.80"));
    expect(calls.reads).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Read receipt" })).toBeNull();
  });

  it("no receipt, or the reader switched off on the API, shows no button", async () => {
    api({ suggestions: SUGGESTIONS, reason: null });
    show({ reader: { enabled: false } });
    expect(screen.queryByRole("button", { name: "Read receipt" })).toBeNull();
    await attach(png());
    expect(screen.queryByRole("button", { name: "Read receipt" })).toBeNull();
  });

  it("a failed read brings the button back, and pressing it tries again", async () => {
    const calls = api(
      { suggestions: null, reason: "timeout" },
      { suggestions: SUGGESTIONS, reason: null },
    );
    show();
    await attachAndRead(png());
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Read receipt" }));
    await waitFor(() => expect(amount()).toHaveValue("48.80"));
    expect(calls.reads).toHaveLength(2);
  });

  it("fills the empty fields, rings and marks them, and says so once", async () => {
    const calls = api({ suggestions: SUGGESTIONS, reason: null });
    show();
    await attachAndRead(png());
    await waitFor(() => expect(amount()).toHaveValue("48.80"));
    expect(calls.reads).toHaveLength(1);
    expect((calls.reads[0].get("receipt") as File).name).toBe("taxi.png");

    expect(description()).toHaveValue("Copy paper");
    expect(supplier()).toHaveValue("Wellcome");
    expect(account()).toHaveValue("Printing & Stationery");
    expect(amount()).toHaveAccessibleDescription("Amount suggested");
    expect(account()).toHaveAccessibleDescription("Account code suggested — please check");
    expect(amount()).toHaveClass("ring-border-selected");
    expect(
      screen.getByText(
        "Suggestions from the receipt filled 4 fields: amount, description, supplier, account. Please check them before adding.",
      ),
    ).toBeInTheDocument();
  });

  it("shows Flask's reading box while it reads, and the card stays usable", async () => {
    let answer: (value: unknown) => void = () => undefined;
    api(() => new Promise((resolve) => (answer = resolve)));
    show();
    await attachAndRead(png());
    expect(await screen.findByText("Reading the receipt…")).toBeInTheDocument();
    await userEvent.type(description(), "Taxi");
    answer({ suggestions: SUGGESTIONS, reason: null });
    await waitFor(() => expect(screen.queryByText("Reading the receipt…")).toBeNull());
    // typed while it read: never overwritten
    expect(description()).toHaveValue("Taxi");
    expect(amount()).toHaveValue("48.80");
  });

  it("Clear empties a suggested field; typing in one makes it the person's", async () => {
    api({ suggestions: SUGGESTIONS, reason: null });
    show();
    await attachAndRead(png());
    await waitFor(() => expect(amount()).toHaveValue("48.80"));
    const clears = screen.getAllByRole("button", {
      name: "Clear the suggested value for this field",
    });
    expect(clears).toHaveLength(4);
    await userEvent.click(clears[0]);
    expect(amount()).toHaveValue("");
    expect(amount()).toHaveFocus();
    expect(amount()).not.toHaveClass("ring-border-selected");

    await userEvent.type(description(), "!");
    expect(description()).toHaveValue("Copy paper!");
    expect(description()).not.toHaveAccessibleDescription(/suggested/);
    expect(
      screen.getAllByRole("button", { name: "Clear the suggested value for this field" }),
    ).toHaveLength(2);
  });

  it("leaves a typed amount alone and offers the receipt's reading on a button", async () => {
    api({ suggestions: SUGGESTIONS, reason: null });
    show();
    await userEvent.type(amount(), "45");
    await attachAndRead(png());
    expect(
      await screen.findByText(/^The receipt reads HKD.48\.80, not HKD.45\.00\.$/),
    ).toBeVisible();
    expect(amount()).toHaveValue("45.00");
    await userEvent.click(screen.getByRole("button", { name: "Use the value from the receipt" }));
    expect(amount()).toHaveValue("48.80");
    expect(amount()).toHaveAccessibleDescription("Amount suggested");
  });

  it("another receipt takes the old one's suggestions with it", async () => {
    const calls = api(
      { suggestions: SUGGESTIONS, reason: null },
      {
        suggestions: { amount: { value: "12", confidence: 0.9, band: "high", applied: true } },
        reason: null,
      },
    );
    show();
    await attachAndRead(png("one.png"));
    await waitFor(() => expect(supplier()).toHaveValue("Wellcome"));
    await attachAndRead(png("two.png"));
    await waitFor(() => expect(amount()).toHaveValue("12.00"));
    expect(calls.reads).toHaveLength(2);
    expect(supplier()).toHaveValue("");
    expect(description()).toHaveValue("");
  });

  it("offers an unknown supplier for New Contact, and creates nothing itself", async () => {
    const calls = api({
      suggestions: {
        supplier: {
          value: "",
          confidence: 0,
          band: "low",
          applied: false,
          contact_id: "",
          detected_name: "Kwok Transport",
        },
      },
      reason: null,
    });
    show();
    await attachAndRead(png());
    expect(
      await screen.findByText('Receipt says "Kwok Transport", which is not in your supplier list.'),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: 'Add "Kwok Transport" as a new supplier' }),
    );
    expect(screen.getByRole("textbox", { name: /New Contact/ })).toHaveValue("Kwok Transport");
    expect(calls.suppliers).toEqual([]);
  });

  it("switched off ('disabled'), it says nothing and is not asked again this session", async () => {
    const calls = api({ suggestions: null, reason: "disabled" });
    show();
    await attachAndRead(png("one.png"));
    await waitFor(() => expect(calls.reads).toHaveLength(1));
    await attach(png("two.png"));
    expect(screen.queryByRole("button", { name: "Read receipt" })).toBeNull();
    expect(calls.reads).toHaveLength(1);
    expect(screen.queryByText("Reading the receipt…")).toBeNull();
    expect(amount()).toHaveValue("");
    expect(sessionStorage.getItem("minty.pc.receipt-reader")).toBe("off");
    expect(
      screen.queryByText("I couldn't read this receipt. Enter the details yourself."),
    ).toBeNull();
  });

  it("a failed read says so in one quiet line, and nothing else changes", async () => {
    const calls = api(() => Promise.reject(new Error("500")));
    show();
    await attachAndRead(png());
    await waitFor(() => expect(calls.reads).toHaveLength(1));
    expect(await screen.findByText(FAILED)).toHaveAttribute("role", "status");
    expect(screen.queryByText("Reading the receipt…")).toBeNull();
    expect(document.querySelector("[data-toast-type]")).toBeNull();
    expect(amount()).toHaveValue("");
  });

  it("a failure reason shows the line; another receipt takes it away", async () => {
    const calls = api(
      { suggestions: null, reason: "timeout" },
      { suggestions: SUGGESTIONS, reason: null },
    );
    show();
    await attachAndRead(png("one.png"));
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    await attachAndRead(png("two.png"));
    await waitFor(() => expect(amount()).toHaveValue("48.80"));
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(calls.reads).toHaveLength(2);
  });

  it("a low-band reading offered as a note is not a failure", async () => {
    api({
      suggestions: { amount: { value: "12.00", confidence: 0.3, band: "low", applied: false } },
      reason: "no_usable_field",
    });
    show();
    await attachAndRead(png());
    expect(await screen.findByText("The receipt might read HKD 12.00.")).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it("nothing at all to show is the quiet line", async () => {
    api({
      suggestions: { amount: { value: "", confidence: 0.1, band: "low", applied: false } },
      reason: "no_usable_field",
    });
    show();
    await attachAndRead(png());
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
  });

  it("Add sends the suggested values with the original receipt", async () => {
    const calls = api({ suggestions: SUGGESTIONS, reason: null });
    const props = show();
    const original = png();
    await attachAndRead(original);
    await waitFor(() => expect(account()).toHaveValue("Printing & Stationery"));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(props.onAdded).toHaveBeenCalled());
    const sent = calls.adds[0];
    expect(sent.get("amount")).toBe("48.8");
    expect(sent.get("description")).toBe("Copy paper");
    expect(sent.get("supplier_id")).toBe("s-well");
    expect(sent.get("account_id")).toBe("a-461");
    expect((sent.get("receipt") as File).name).toBe("taxi.png");
    expect(await (sent.get("receipt") as File).text()).toBe(await original.text());
  });

  it("a refused Add's red border goes once the reader fills the field", async () => {
    let answer: (value: unknown) => void = () => undefined;
    api(() => new Promise((resolve) => (answer = resolve)));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(amount()).toHaveAttribute("aria-invalid", "true");
    await attachAndRead(png());
    answer({ suggestions: SUGGESTIONS, reason: null });
    await waitFor(() => expect(amount()).toHaveValue("48.80"));
    expect(amount()).not.toHaveAttribute("aria-invalid");
    expect(within(supplier().parentElement!).queryByText("*")).toBeNull();
  });
});

describe("the supplier picker tells the person they can type to add (owner, 2026-11-12)", () => {
  const NOTE = "Type a contact name to add a new contact";

  it("shows the note as soon as the list opens; typing a new name brings the add row instead", async () => {
    api();
    show();
    await userEvent.click(supplier());
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    await userEvent.type(supplier(), "Kee Wah");
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "+ Add 'Kee Wah' as a new contact" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No contact found")).toBeInTheDocument();
  });

  it("opens with the note even before the company has any supplier", async () => {
    api();
    show({ suppliers: [] });
    await userEvent.click(supplier());
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it("someone who may not add a supplier sees no note", async () => {
    api();
    show({ canCreateSupplier: false });
    await userEvent.click(supplier());
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });
});

describe("Edit Expense (the add card on a saved draft line)", () => {
  const LINE = {
    id: "l1",
    item: "General Expenses",
    amount: 1200.5,
    description: "Milk",
    supplier: SUPPLIERS[0],
    account: ACCOUNTS[0],
    receipts: [{ id: "r1", name: "milk.png", mime_type: "image/png" }],
  };
  const form = (fd: FormData) =>
    Object.fromEntries(Array.from(fd.keys()).map((k) => [k, fd.get(k)]));

  it("opens filled in from the line, titled Edit Expense, with the current receipt named", () => {
    api(READER_OFF_ANSWER);
    show({ line: LINE });
    expect(screen.getByRole("heading", { name: "Edit Expense" })).toBeInTheDocument();
    expect(amount()).toHaveValue("1,200.50");
    expect(description()).toHaveValue("Milk");
    expect(supplier()).toHaveValue("Wellcome");
    expect(account()).toHaveValue("General Expenses");
    expect(screen.getByText(/milk\.png/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("saves only what changed, with no receipt needed, and hands back the line", async () => {
    const { edits } = api(READER_OFF_ANSWER);
    const props = show({ line: LINE });
    await userEvent.clear(amount());
    await userEvent.type(amount(), "99.90");
    await userEvent.click(supplier());
    await userEvent.click(screen.getByRole("option", { name: "ParknShop" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith({ id: "l1" }, 99.9));
    expect(edits).toHaveLength(1);
    expect(edits[0].path).toBe("/expense-lines/l1");
    expect(edits[0].method).toBe("PATCH");
    expect(form(edits[0].form)).toEqual({ amount: "99.9", supplier_id: "s-park" });
    expect(props.onAdded).not.toHaveBeenCalled();
  });

  it("sends a newly picked receipt to replace the line's", async () => {
    const { edits } = api(READER_OFF_ANSWER);
    const props = show({ line: LINE });
    await attach(png("new.png"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    const sent = edits[0].form.get("receipt") as File;
    expect(sent.name).toBe("new.png");
    expect(Array.from(edits[0].form.keys())).toEqual(["receipt"]);
  });

  it("closes without sending anything when nothing changed", async () => {
    const { edits } = api(READER_OFF_ANSWER);
    const props = show({ line: LINE });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onCancel).toHaveBeenCalled();
    expect(edits).toHaveLength(0);
  });
});
