// A submitted report's line editor (components/report/ReportEdits.tsx `LineEditor`), with the Petty
// Cash API stubbed: Save changes sends only what changed as one `PATCH /reports/<id>/expense-lines/<id>`,
// and the duplicate reminder (owner's decisions doc DUP1, 2026-11-19) asks before a changed supplier
// makes the line look like another one of the day. No save goes without a receipt (the user,
// 2026-11-25): the receipt row's × takes the saved one off, and Save is refused until one is attached.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/apiClient", async (original) => ({
  ...(await original<typeof import("@/lib/apiClient")>()),
  pettyCashFetch: vi.fn(),
  pettyCashBlob: vi.fn(),
}));

import { ToastProvider } from "@/components/flask/Toasts";
import { LineEditor } from "@/components/report/ReportEdits";
import { ApiError, pettyCashBlob, pettyCashFetch } from "@/lib/apiClient";
import type { DailyReport, ReportLine } from "@/lib/report";

const fetchMock = vi.mocked(pettyCashFetch);

const SUPPLIERS = [
  { id: "s-well", name: "Wellcome" },
  { id: "s-abc", name: "ABC Supplies" },
];
const ACCOUNTS = [{ id: "a-429", code: "429", name: "General Expenses" }];
const LINE: ReportLine = {
  id: "e1",
  item: "General Expenses",
  amount: 1012.5,
  description: "Paper",
  supplier: SUPPLIERS[0],
  account: ACCOUNTS[0],
  receipts: [{ id: "rc1", name: "paper.png", mime_type: "image/png" }],
} as ReportLine;
const REPORT = {
  report_id: "r-1",
  currency_code: "HKD",
  options: { suppliers: SUPPLIERS, accounts: ACCOUNTS },
} as unknown as DailyReport;

const SENTENCE =
  "This looks like an expense you already have on this day: the same supplier and amount. Save it anyway?";
const DUPLICATE = new ApiError(409, SENTENCE, {
  error: SENTENCE,
  duplicates: [
    { id: "e2", description: "Copy paper", amount: "1012.50", supplier: "ABC Supplies" },
  ],
});

const sentForms: FormData[] = [];

beforeAll(() => {
  // jsdom has neither; the saved receipt is shown from an object URL
  URL.createObjectURL ??= () => "blob:receipt";
  URL.revokeObjectURL ??= () => undefined;
});
beforeEach(() => {
  vi.mocked(pettyCashBlob).mockResolvedValue(new Blob(["png"], { type: "image/png" }));
});

/** The API answers each PATCH with the next of `answers` (an ApiError is thrown). */
function api(...answers: unknown[]) {
  sentForms.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_path, init) => {
    sentForms.push(init?.form as FormData);
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next instanceof Error) throw next;
    return next;
  });
}

function show(line: ReportLine = LINE) {
  const props = { onSaved: vi.fn(), onClose: vi.fn() };
  render(
    <ToastProvider>
      <LineEditor report={REPORT} line={line} {...props} />
    </ToastProvider>,
  );
  return props;
}

const fields = (fd: FormData) =>
  Object.fromEntries(Array.from(fd.keys()).map((k) => [k, fd.get(k)]));

async function changeSupplierAndSave() {
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Supplier" }), "s-abc");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
}

describe("LineEditor's Save changes", () => {
  it("sends only the changed supplier and hands the report back", async () => {
    api({ report_id: "r-1" });
    const props = show();
    await changeSupplierAndSave();
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith({ report_id: "r-1" }));
    expect(fetchMock.mock.calls[0][0]).toBe("/reports/r-1/expense-lines/e1");
    expect(fields(sentForms[0])).toEqual({ supplier_id: "s-abc" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("another refusal shows the API's sentence and saves nothing", async () => {
    api(
      new ApiError(409, "This report is being published.", {
        error: "This report is being published.",
      }),
    );
    const props = show();
    await changeSupplierAndSave();
    expect(await screen.findByText("This report is being published.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Save it anyway?" })).toBeNull();
    expect(props.onSaved).not.toHaveBeenCalled();
  });
});

describe("the duplicate reminder (DUP1)", () => {
  it("asks with the API's sentence and the matching line", async () => {
    api(DUPLICATE);
    const props = show();
    await changeSupplierAndSave();
    const dialog = await screen.findByRole("dialog", { name: "Save it anyway?" });
    expect(dialog).toHaveTextContent(SENTENCE);
    expect(dialog).toHaveTextContent("Copy paper");
    expect(dialog).toHaveTextContent("ABC Supplies");
    expect(dialog).toHaveTextContent("HKD 1,012.50");
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it("Save anyway sends the same change with confirm_duplicate and finishes the save", async () => {
    api(DUPLICATE, { report_id: "r-1" });
    const props = show();
    await changeSupplierAndSave();
    await userEvent.click(await screen.findByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith({ report_id: "r-1" }));
    expect(sentForms).toHaveLength(2);
    expect(fields(sentForms[1])).toEqual({ supplier_id: "s-abc", confirm_duplicate: "true" });
    expect(props.onClose).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Save it anyway?" })).toBeNull();
  });

  it("Go back sends nothing more and keeps the change on the form", async () => {
    api(DUPLICATE);
    const props = show();
    await changeSupplierAndSave();
    const dialog = await screen.findByRole("dialog", { name: "Save it anyway?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("dialog", { name: "Save it anyway?" })).toBeNull();
    expect(sentForms).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: "Supplier" })).toHaveValue("s-abc");
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

describe("the receipt row: no save without a receipt (the user, 2026-11-25)", () => {
  const MISSING = "The receipt is still missing. Attach a receipt to continue.";
  const png = (name: string) => new File(["png"], name, { type: "image/png" });
  const attach = (file: File) =>
    userEvent.upload(screen.getByLabelText("Choose a new receipt"), file);
  const save = () => userEvent.click(screen.getByRole("button", { name: "Save changes" }));

  it("lists the saved receipt with Remove", async () => {
    show();

    expect(screen.getByRole("button", { name: "Remove paper.png" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "paper.png" })).toBeInTheDocument();
  });

  it("refuses Save once the saved receipt is removed, and sends nothing", async () => {
    api({ report_id: "r-1" });
    const props = show();
    await screen.findByRole("img", { name: "paper.png" });

    await userEvent.click(screen.getByRole("button", { name: "Remove paper.png" }));
    expect(screen.queryByRole("img", { name: "paper.png" })).toBeNull();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Supplier" }), "s-abc");
    await save();

    expect(screen.getByText(MISSING)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Receipt\/Document/ })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it("saves with the new receipt attached in the removed one's place", async () => {
    api({ report_id: "r-1" });
    const props = show();
    await userEvent.click(screen.getByRole("button", { name: "Remove paper.png" }));

    await attach(png("new.png"));
    await save();

    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect((sentForms[0].get("receipt") as File).name).toBe("new.png");
  });

  it("removing a new pick brings the saved receipt back", async () => {
    api({ report_id: "r-1" });
    const props = show();
    await attach(png("new.png"));

    await userEvent.click(screen.getByRole("button", { name: "Remove new.png" }));
    expect(screen.getByRole("button", { name: "Remove paper.png" })).toBeInTheDocument();
    await changeSupplierAndSave();

    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(fields(sentForms[0])).toEqual({ supplier_id: "s-abc" });
  });

  it("refuses Save on a line that has no receipt until one is attached", async () => {
    api({ report_id: "r-1" });
    show({ ...LINE, receipts: [] });

    await changeSupplierAndSave();

    expect(screen.getByText(MISSING)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
