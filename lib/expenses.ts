/**
 * The Expenses step's read: what `GET /reports/expenses` answers (Minty
 * `petty_cash_api/routes/expenses.py`), and the page's rules as Flask's `report/expense.html` has
 * them - the supplier and account searches, the receipt checks, the required fields and the
 * Expense Details rows.
 */

import { isHeic } from "@minty/shared/heic";
import type { ReaderStatus } from "@minty/shared/reader";
import { parseMoney } from "@/lib/currencyInput";
import type { OpeningPage } from "@/lib/opening";

export type Supplier = { id: string; name: string };
export type Account = { id: string; code: string; name: string };
export type Receipt = { id: string; name: string; mime_type: string | null };

export type ExpenseLine = {
  id: string;
  /** The account's name, as the line was saved ("" when none). */
  item: string;
  amount: number;
  description: string;
  supplier: Supplier | null;
  account: Account | null;
  receipts: Receipt[];
};

export type ExpensesPage = {
  transaction_date: string;
  currency_code: string | null;
  draft: OpeningPage["draft"];
  /** The version the step's save carries back (R2; `lib/stepConflict.ts`); lines never carry it.
   * Absent from an older API. */
  edit_version?: number | null;
  lines: ExpenseLine[];
  total: number;
  /** The company's synced Xero contacts, A to Z. */
  suppliers: Supplier[];
  /** The accounts switched on for Petty Cash, in the API's order. */
  accounts: Account[];
  permissions: { create_supplier: boolean };
  /**
   * Whether "Read receipt" is offered (`EXPENSE_AI_ENABLED` and a usable `ai_policy`), and the
   * company's AI allowance left - one allowance with Payment Request (owner, 2026-11-18). Absent from an
   * older API = off; an older API's `{enabled}` alone = on, with no count shown.
   */
  reader?: ReaderStatus;
};

/**
 * The supplier dropdown for what is typed (Flask's `initializeContactSearch`): every supplier when
 * nothing is typed, else those whose name holds the text, any case - always A to Z. `offerNew` is
 * the text to offer as a new contact: there are matches but none is exactly the text, or there
 * are none at all (Flask's "No Xero contact found" state).
 */
export function searchSuppliers(
  suppliers: Supplier[],
  typed: string,
): { matches: Supplier[]; offerNew: string | null } {
  const query = typed.trim();
  const sorted = (list: Supplier[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));
  if (!query) return { matches: sorted(suppliers), offerNew: null };
  const q = query.toLowerCase();
  const matches = sorted(suppliers.filter((s) => s.name.toLowerCase().includes(q)));
  const exact = suppliers.some((s) => s.name.toLowerCase() === q);
  return { matches, offerNew: exact ? null : query };
}

/** The account dropdown for what is typed: by name or code, any case, in order. Each option
 * shows its code ("Wages and Salaries 477"), so "477" finds it - Flask's
 * `initializeAccountSearch` matched the name only (owner, 2026-10-27). */
export function searchAccounts(accounts: Account[], typed: string): Account[] {
  const q = typed.trim().toLowerCase();
  if (!q) return accounts;
  return accounts.filter(
    (a) => a.name.toLowerCase().includes(q) || (a.code || "").toLowerCase().includes(q),
  );
}

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
/** A file with no type (Windows and some Android pickers give none) is judged by its name. */
const RECEIPT_NAME = /\.(pdf|jpe?g|png)$/i;

/**
 * The receipt picker's `accept`. JPEG first: iOS hands a HEIC photo over as the first type it can
 * (so most iPhone photos arrive as JPEG), and a camera shot is a JPEG. HEIC is still taken as it
 * is - from Files, a Mac, an Android phone on "high-efficiency" photos (the user, 2026-11-24).
 * Mixed with PDF, it also makes Android offer the camera beside its files.
 */
export const RECEIPT_ACCEPT =
  "image/jpeg,image/png,application/pdf,image/heic,image/heif,.jpg,.jpeg,.png,.pdf,.heic,.heif";

type PickedFile = { name: string; size: number; type: string };

function takesReceipt(file: PickedFile): boolean {
  if (RECEIPT_TYPES.includes(file.type) || isHeic(file.type, file.name)) return true;
  return !file.type && RECEIPT_NAME.test(file.name);
}

/**
 * Why a picked or dropped receipt is refused, in Flask's words, or null. A drop names the file, as
 * Flask's drop handler does; more than one file is refused only on a drop (the picker takes one).
 */
export function receiptProblem(files: PickedFile[], how: "picked" | "dropped"): string | null {
  if (how === "dropped" && files.length > 1) return "Only one file is allowed per expense.";
  const say = (sentence: string, file: PickedFile) =>
    how === "dropped" ? `${sentence}: ${file.name}` : `${sentence}.`;
  for (const file of files) {
    if (file.size > MAX_RECEIPT_BYTES) return say("Files need to be under 10MB", file);
    if (!takesReceipt(file)) return say("I can take PDF, JPEG, PNG, or HEIC files", file);
  }
  return null;
}

/**
 * No line is saved without a receipt (the user, 2026-11-25): Edit Expense and Edit Details refuse
 * Save with this once the receipt is removed (Part 11: the issue, then the action).
 */
export const RECEIPT_MISSING = "The receipt is still missing. Attach a receipt to continue.";

/** A receipt's file name in the upload box: cut to 27 characters and "..." past 30. */
export function uploadName(name: string): string {
  return name.length > 30 ? `${name.slice(0, 27)}...` : name;
}

/** The API's limit on a new contact's name (`MAX_SUPPLIER_NAME` in `routes/expenses.py`). */
export const MAX_SUPPLIER_NAME = 150;

/** A New Contact name as it is typed, in the API's words; null when it fits. */
export function newContactProblem(name: string): string | null {
  return name.trim().length > MAX_SUPPLIER_NAME
    ? `Keep the supplier's name to ${MAX_SUPPLIER_NAME} characters or fewer.`
    : null;
}

export type AddForm = {
  amount: string;
  supplierText: string;
  supplier: Supplier | null;
  /** A supplier the receipt reader read and the company lacks: the API adds it on save. */
  newSupplier?: { name: string } | null;
  accountText: string;
  account: Account | null;
  file: File | null;
};

export type RequiredField = "amount" | "supplier" | "account" | "file";

/**
 * The fields Add refuses (Flask's `addExpense`), each drawn with a red border: an amount of 0, a
 * supplier or an account not chosen from its list (or its text changed since), no receipt. The
 * receipt reader's new supplier counts while the box still holds its name (the user, 2026-11-23).
 */
export function missingFields(form: AddForm): RequiredField[] {
  const missing: RequiredField[] = [];
  if (parseMoney(form.amount) === 0) missing.push("amount");
  const read = !form.supplier && form.newSupplier?.name === form.supplierText.trim();
  if (!read && (!form.supplier || form.supplierText.trim() !== form.supplier.name))
    missing.push("supplier");
  if (!form.account || form.accountText.trim() !== form.account.name) missing.push("account");
  if (!form.file || form.file.size === 0) missing.push("file");
  return missing;
}

/** What Edit Expense compares with the saved line. */
export type LineEditForm = {
  amount: string;
  description: string;
  supplier: Supplier | null;
  account: Account | null;
};

/**
 * The fields of a draft line that Edit Expense changed, by `PATCH /expense-lines/{id}`'s names -
 * the API keeps whatever is not sent. The amount is compared in cents (grouping aside), the
 * description as the API stores it (trimmed; an emptied one is sent, which clears it), and a
 * supplier or account only once one is chosen from its list.
 */
export function lineEdits(line: ExpenseLine, form: LineEditForm): Record<string, string> {
  const edits: Record<string, string> = {};
  const amount = parseMoney(form.amount);
  if (Math.round(amount * 100) !== Math.round(line.amount * 100)) edits.amount = String(amount);
  const description = form.description.trim();
  if (description !== (line.description ?? "")) edits.description = description;
  if (form.supplier && form.supplier.id !== line.supplier?.id) edits.supplier_id = form.supplier.id;
  if (form.account && form.account.id !== line.account?.id) edits.account_id = form.account.id;
  return edits;
}

/** Expense Details' rows, as Flask writes them: "N/A" and "-" for what a line lacks. */
export function detailRows(line: ExpenseLine): {
  contact: string;
  description: string;
  account: string;
} {
  return {
    contact: line.supplier?.name || "N/A",
    description: line.description || "-",
    account: `${line.account?.code || "N/A"} ${line.item}`,
  };
}
