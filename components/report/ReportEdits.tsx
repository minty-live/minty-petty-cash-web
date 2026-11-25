"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { guardLeave, useLeaveGuard } from "@minty/shared/leaveGuard";

import { useToast } from "@/components/flask/Toasts";
import { DuplicateDialog } from "@/components/report/DuplicateDialog";
import { ExpenseDetailsModal, ExpenseRow } from "@/components/report/ExpensesStep";
import { LeaveDialog } from "@/components/ui/LeaveDialog";
import { ReceiptRow } from "@/components/report/ReceiptRow";
import { FieldMessage } from "@/components/report/ReportChrome";
import { ApiError, pettyCashFetch } from "@/lib/apiClient";
import { CONFIRM_DUPLICATE, duplicatesOf, type DuplicateWarning } from "@/lib/duplicates";
import {
  RECEIPT_ACCEPT,
  RECEIPT_MISSING,
  uploadName,
  type Account,
  type Supplier,
} from "@/lib/expenses";
import { formatMoney } from "@/lib/money";
import {
  EDIT_SAVED,
  EDIT_UNSAVED,
  editReasonProblem,
  editReceiptProblem,
  lineChanges,
  descriptionProblem,
  type DailyReport,
  type ReportLine,
} from "@/lib/report";

/**
 * A submitted report's Edit Details - Flask's ORIGINAL constrained "report_edit" mode (Minty
 * `1c25b35^1`), which changed the three details that move no balance on the step pages:
 * - the difference reason (`report/cash_count.html`'s box and "Save changes");
 * - where the addition to the drawer came from (`report/opening.html`'s "Withdrawal from:");
 * - an expense line's description, supplier, account and receipt (`report/expense.html`'s
 *   editor inside Expense Details).
 *
 * Here they are drawn in the report's own view. Each sends one call (`PUT
 * /reports/<id>/difference-reason`, `PUT /reports/<id>/withdrawal`, `PATCH
 * /reports/<id>/expense-lines/<line id>`; Minty `petty_cash_api/routes/report.py`), which answers
 * the whole Daily Report: the page is drawn again from it (`onSaved`). A refusal shows the API's
 * sentence at the field and changes nothing; Flask's success toasts, word for word, only after
 * the API said yes.
 */

const UNREACHABLE = "We couldn't reach Petty Cash. Check your connection, then reload the page.";
const NOTHING_CHANGED = "Nothing has changed yet. Change a detail to save it.";

/** Flask's small "Save changes" (`text-sm px-4 py-2 rounded-lg`), 44px tall on a phone. */
const SAVE_SMALL =
  "min-h-[44px] rounded-flask-lg bg-flask-teal px-4 py-2 text-sm font-medium text-flask-white transition-colors hover:bg-flask-teal-hover active:bg-flask-teal-pressed disabled:opacity-70 sm:min-h-0";
const CARD = "mb-6 rounded-flask-lg bg-flask-white p-6 shadow-flask-sm";
const CARD_TITLE = "text-sm font-semibold text-flask-gray-900 sm:text-lg";
/** The line editor's fields, as Flask's (`px-3 py-2 border rounded-lg text-sm`). */
const EDIT_FIELD =
  "w-full rounded-flask-lg border bg-flask-white px-3 py-2 text-sm text-flask-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-flask-focus";
const EDIT_LABEL = "mb-1 block text-sm font-medium text-flask-gray-700";

type Saved = (report: DailyReport) => void;
/** An editor saying whether it holds changes not saved yet (`useUnsavedEdits`). */
type Dirty = (dirty: boolean) => void;

/** Tell the page whether this editor holds unsaved changes; an editor that goes away holds none. */
function useReportDirty(dirty: boolean, onDirty: Dirty | undefined) {
  const onDirtyRef = useRef(onDirty);
  useEffect(() => {
    onDirtyRef.current = onDirty;
  });
  useEffect(() => {
    onDirtyRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => onDirtyRef.current?.(false), []);
}

/**
 * Unsaved changes in Edit Details, on the summary and the step pages (owner, 2026-11-17): while an
 * editor holds changes, a link that leaves (the stepper, the header's Back, the sidebar) and the
 * browser's Back ask "Leave without saving?" in the page (`@minty/shared/leaveGuard`, the
 * `LeaveDialog`); `leave(proceed)` asks the same for an exit that is a button (Done editing).
 * "Discard changes" remounts the editors with the saved values (`round` goes in their keys) and
 * runs `onDiscard` (closing a line editor), then goes on. A reload or a closed tab leaves without
 * asking - the only prompt a browser allows there is its own, and Minty shows none.
 */
export function useUnsavedEdits(onDiscard: () => void): {
  track: (key: string) => Dirty;
  round: number;
  leave: (proceed: () => void) => void;
  ui: ReactNode;
} {
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [round, setRound] = useState(0);
  const onDiscardRef = useRef(onDiscard);
  useEffect(() => {
    onDiscardRef.current = onDiscard;
  });
  const reset = useCallback(() => {
    setDirty({});
    setRound((r) => r + 1);
    onDiscardRef.current();
  }, []);
  const guard = useLeaveGuard(Object.values(dirty).some(Boolean), reset);
  const trackers = useRef(new Map<string, Dirty>());
  const track = useCallback((key: string) => {
    let tracker = trackers.current.get(key);
    if (!tracker) {
      tracker = (isDirty: boolean) =>
        setDirty((all) => (Boolean(all[key]) === isDirty ? all : { ...all, [key]: isDirty }));
      trackers.current.set(key, tracker);
    }
    return tracker;
  }, []);
  return {
    track,
    round,
    leave: guardLeave,
    ui: guard.open ? <LeaveDialog onDiscard={guard.discard} onStay={guard.stay} /> : null,
  };
}

/** The sentence a refusal carried (the API's own), or the connection's. */
function refusalOf(err: unknown): string {
  return err instanceof ApiError ? err.message : UNREACHABLE;
}

const reportPath = (report: DailyReport) => `/reports/${encodeURIComponent(report.report_id)}`;

/**
 * The difference reason, edited in the shortage or surplus box: Flask's rounded box and its
 * "Save changes". Checked as it is typed - at most 300 characters, never emptied while the cash
 * was short or over.
 */
export function ReasonEditor({
  report,
  onSaved,
  onDirty,
}: {
  report: DailyReport;
  onSaved: Saved;
  onDirty?: Dirty;
}) {
  const toast = useToast();
  const field = useRef<HTMLTextAreaElement>(null);
  const { kind } = report.cash.difference;
  const [reason, setReason] = useState(report.cash.difference.reason);
  const [refused, setRefused] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const problem = editReasonProblem(reason, kind);
  useReportDirty(reason !== report.cash.difference.reason, onDirty);
  const message = refused ?? problem;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (problem) {
      field.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const answer = await pettyCashFetch<DailyReport>(`${reportPath(report)}/difference-reason`, {
        method: "PUT",
        json: { reason },
      });
      setReason(answer.cash.difference.reason);
      onSaved(answer);
      toast(EDIT_SAVED.reason, "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setRefused(refusalOf(err));
      field.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="mt-2" noValidate>
      <textarea
        ref={field}
        name="discrepancy_reason"
        aria-label="Reason (required)"
        aria-required={kind !== "none" ? true : undefined}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? "reason_message" : undefined}
        rows={2}
        placeholder="Description"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setRefused(null);
        }}
        className={`block w-full resize-none rounded-flask-2xl border bg-flask-white px-3 py-3 text-sm text-flask-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-flask-focus ${
          message ? "border-flask-red-500" : "border-flask-gray-300"
        }`}
      />
      {message ? <FieldMessage id="reason_message">{message}</FieldMessage> : null}
      <div className="mt-3 flex justify-end">
        <button type="submit" disabled={saving} className={SAVE_SMALL}>
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </form>
  );
}

/** The olive Edit Details / Done editing button, on the summary and the step pages alike. */
export function EditDetailsButton({
  editing,
  onToggle,
  spacing,
}: {
  editing: boolean;
  onToggle: () => void;
  /** Where it sits: the summary's `mt-6` among its actions, a step page's `mb-4` above Close. */
  spacing: string;
}) {
  const icon = "size-6 transition-transform duration-300 group-hover:scale-[1.2]";
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group ${spacing} flex w-full items-center justify-center gap-2 rounded-flask-xl border-2 border-flask-secondary-edge bg-flask-white text-flask-secondary-ink hover:bg-flask-teal-soft px-4 py-3 font-medium shadow-flask-md transition-colors`}
    >
      {editing ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          className={icon}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          className={icon}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125"
          />
        </svg>
      )}
      <span>{editing ? "Done editing" : "Edit Details"}</span>
    </button>
  );
}

/**
 * "Addition to Cash Drawer": the amount (never editable), then Flask's "Withdrawal from:" -
 * Company Bank or Personal (Personal when none was saved, as Flask checked it) - and "Save changes".
 * `inline` (the Opening step page, where the amount is already drawn): the choice and its Save only.
 */
export function WithdrawalCard({
  report,
  onSaved,
  inline = false,
  onDirty,
}: {
  report: DailyReport;
  onSaved: Saved;
  inline?: boolean;
  onDirty?: Dirty;
}) {
  const toast = useToast();
  const saved = report.cash.cash_addition_type === "company" ? "company" : "personal";
  const [choice, setChoice] = useState<"company" | "personal">(saved);
  useReportDirty(choice !== saved, onDirty);
  const [refused, setRefused] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const answer = await pettyCashFetch<DailyReport>(`${reportPath(report)}/withdrawal`, {
        method: "PUT",
        json: { withdrawal_type: choice },
      });
      onSaved(answer);
      toast(EDIT_SAVED.withdrawal, "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setRefused(refusalOf(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className={inline ? "mb-4" : CARD} noValidate>
      {inline ? null : (
        <>
          <h3 className={`mb-4 ${CARD_TITLE}`}>Addition to Cash Drawer</h3>
          <div className="mb-4 w-full rounded-flask-xl border border-flask-gray-300 bg-flask-gray-200 px-3 py-3 text-flask-gray-500 [overflow-wrap:anywhere]">
            {formatMoney(report.cash.cash_addition, report.currency_code)}
          </div>
        </>
      )}
      <fieldset aria-describedby={refused ? "withdrawal_message" : undefined}>
        <legend className="mb-2 block text-sm font-medium text-flask-gray-700">
          Withdrawal from:
        </legend>
        <div className="space-y-2">
          {(
            [
              ["company", "Company Bank"],
              ["personal", "Personal"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center">
              <input
                type="radio"
                name="withdrawal_edit"
                value={value}
                checked={choice === value}
                onChange={() => {
                  setChoice(value);
                  setRefused(null);
                }}
                className="flask-radio"
              />
              <span className="ml-2 text-sm text-flask-gray-700">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {refused ? <FieldMessage id="withdrawal_message">{refused}</FieldMessage> : null}
      <div className="mt-3 flex justify-end">
        <button type="submit" disabled={saving} className={SAVE_SMALL}>
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </form>
  );
}

/** The day's lines as the Expenses step lists them (no bin); a tap opens the line's editor. */
export function EditLinesCard({
  report,
  onOpen,
}: {
  report: DailyReport;
  onOpen: (line: ReportLine) => void;
}) {
  return (
    <div className={CARD}>
      <h3 className={`mb-4 ${CARD_TITLE}`}>Expenses</h3>
      {/* block, not flex: the rows overlap by their -12px margins, as on the Expenses step */}
      <div>
        {report.expenses.lines.map((line) => (
          <ExpenseRow
            key={line.id}
            line={line}
            code={report.currency_code}
            onOpen={() => onOpen(line)}
          />
        ))}
      </div>
    </div>
  );
}

type LineField = "description" | "supplier" | "account" | "receipt" | "form";

/** Which field an API refusal belongs to, by its sentence (`report_edits.py`, `checked_receipt`). */
function fieldOf(sentence: string): LineField {
  if (sentence.startsWith("Choose a supplier")) return "supplier";
  if (sentence.startsWith("Choose an account")) return "account";
  if (sentence.startsWith("Keep the description")) return "description";
  if (sentence.startsWith("Attach") || sentence.startsWith("That file is empty")) return "receipt";
  return "form";
}

/** The line's own choice, kept in the list even when it is no longer among the options. */
function withCurrent<T extends { id: string }>(list: T[], current: T | null): T[] {
  return current && !list.some((x) => x.id === current.id) ? [current, ...list] : list;
}

/**
 * Expense Details with Flask's editor in place of the grey box: the receipt and "Amount Paid"
 * (never editable), then Description, Supplier and Account Code (Flask's selects, from the read's
 * `options`), Receipt/Document ("Click to change files", one PDF, JPEG or PNG of 10 MB at most,
 * checked before it is sent) and "Save changes". Only what changed is sent. Escape or a click
 * outside keeps an editor with changes open (Flask's toast); Close with changes asks "Leave without
 * saving?" (owner, 2026-11-17; Flask's discarded them). A changed supplier that makes the line look
 * like another of the day is DUP1's 409: `DuplicateDialog` asks, and Save anyway resends the same
 * changes with `confirm_duplicate=true`.
 *
 * The receipt sits in a row (`ReceiptRow`, as Bills lists an uploaded file) with × (the user,
 * 2026-11-25): on a new pick it takes it off and the saved receipt comes back; on the saved one it
 * takes that off too (and out of the preview above). No line is saved without a receipt: Save is
 * then refused with `RECEIPT_MISSING` under the box until one is attached - also on an old line
 * that never had one. The API keeps the saved receipt unless another is sent, so nothing is lost
 * until a new one is saved.
 */
export function LineEditor({
  report,
  line,
  onSaved,
  onClose,
  onDirty,
}: {
  report: DailyReport;
  line: ReportLine;
  onSaved: Saved;
  onClose: () => void;
  onDirty?: Dirty;
}) {
  const toast = useToast();
  const options = report.options ?? { suppliers: [], accounts: [] };
  const suppliers = withCurrent<Supplier>(options.suppliers, line.supplier);
  const accounts = withCurrent<Account>(options.accounts, line.account);
  const fileInput = useRef<HTMLInputElement>(null);
  const descriptionField = useRef<HTMLTextAreaElement>(null);
  const receiptBox = useRef<HTMLButtonElement>(null);
  const [description, setDescription] = useState(line.description);
  const [supplierId, setSupplierId] = useState(line.supplier?.id ?? "");
  const [accountId, setAccountId] = useState(line.account?.id ?? "");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptRefused, setReceiptRefused] = useState<string | null>(null);
  // the saved receipt's × (the user, 2026-11-25): gone from the row and the preview until saved
  const [savedRemoved, setSavedRemoved] = useState(false);
  const saved = savedRemoved ? null : (line.receipts[0] ?? null);
  // one identity per state: the preview above reads its receipts by this line's identity
  const shownLine = useMemo(
    () => (savedRemoved ? { ...line, receipts: [] } : line),
    [line, savedRemoved],
  );
  const [refused, setRefused] = useState<{ field: LineField; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<{ warning: DuplicateWarning; form: FormData } | null>(
    null,
  );

  const changes = lineChanges(line, { description, supplierId, accountId, receipt });
  const dirty = Object.keys(changes).length > 0;
  useReportDirty(dirty, onDirty);
  // read when Escape or a click outside asks: the modal's handler must keep one identity, or it
  // takes the focus back from the field being typed in
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  const dismiss = useCallback(() => {
    if (dirtyRef.current) toast(EDIT_UNSAVED, "warning");
    else onClose();
  }, [toast, onClose]);
  const say = (field: LineField) => (refused?.field === field ? refused.message : null);
  const descriptionMessage = say("description") ?? descriptionProblem(description);
  const receiptMessage = say("receipt") ?? receiptRefused;
  const supplierMessage = say("supplier");
  const accountMessage = say("account");
  const formMessage = say("form");

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return; // the picker was cancelled: what was picked stays
    const problem = editReceiptProblem(file);
    setRefused(null);
    setReceiptRefused(problem);
    setReceipt(problem ? null : file);
  }

  function removeReceipt() {
    if (receipt) {
      setReceipt(null);
      setReceiptRefused(null);
    } else setSavedRemoved(true);
    // the × is gone: the keyboard goes back to the box
    receiptBox.current?.focus();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (descriptionProblem(description)) {
      descriptionField.current?.focus();
      return;
    }
    // no save without a receipt (the user, 2026-11-25)
    if (!receipt && !saved) {
      setRefused({ field: "receipt", message: RECEIPT_MISSING });
      receiptBox.current?.focus();
      return;
    }
    if (!dirty) {
      setRefused({ field: "form", message: NOTHING_CHANGED });
      return;
    }
    const form = new FormData();
    if (changes.description !== undefined) form.append("description", changes.description);
    if (changes.supplier_id) form.append("supplier_id", changes.supplier_id);
    if (changes.account_id) form.append("account_id", changes.account_id);
    if (changes.receipt) form.append("receipt", changes.receipt, changes.receipt.name);
    await send(form);
  }

  async function send(form: FormData) {
    setSaving(true);
    setRefused(null);
    try {
      const answer = await pettyCashFetch<DailyReport>(
        `${reportPath(report)}/expense-lines/${encodeURIComponent(line.id)}`,
        { method: "PATCH", form },
      );
      onSaved(answer);
      toast(EDIT_SAVED.line, "success");
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      // DUP1: a changed supplier makes it look like another line of the day - ask (lib/duplicates.ts)
      const warning = duplicatesOf(err);
      if (warning) {
        setDuplicate({ warning, form });
        return;
      }
      const message = refusalOf(err);
      const field = err instanceof ApiError ? fieldOf(message) : "form";
      setRefused({ field, message });
      if (field === "description") descriptionField.current?.focus();
      if (field === "receipt") receiptBox.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  const editor = (
    <form onSubmit={(e) => void save(e)} className="mt-4 space-y-3 text-left" noValidate>
      <div>
        <label htmlFor="editExpDescription" className={EDIT_LABEL}>
          Description
        </label>
        <textarea
          ref={descriptionField}
          id="editExpDescription"
          rows={2}
          value={description}
          aria-invalid={descriptionMessage ? true : undefined}
          aria-describedby={descriptionMessage ? "editExpDescription_message" : undefined}
          onChange={(e) => {
            setDescription(e.target.value);
            if (refused?.field === "description" || refused?.field === "form") setRefused(null);
          }}
          className={`${EDIT_FIELD} ${descriptionMessage ? "border-flask-red-500" : "border-flask-gray-300"}`}
        />
        {descriptionMessage ? (
          <FieldMessage id="editExpDescription_message">{descriptionMessage}</FieldMessage>
        ) : null}
      </div>
      <div>
        <label htmlFor="editExpContact" className={EDIT_LABEL}>
          Supplier
        </label>
        <select
          id="editExpContact"
          value={supplierId}
          aria-invalid={supplierMessage ? true : undefined}
          aria-describedby={supplierMessage ? "editExpContact_message" : undefined}
          onChange={(e) => {
            setSupplierId(e.target.value);
            setRefused(null);
          }}
          className={`${EDIT_FIELD} min-h-[44px] sm:min-h-0 ${supplierMessage ? "border-flask-red-500" : "border-flask-gray-300"}`}
        >
          <option value="" disabled>
            — Select supplier —
          </option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {supplierMessage ? (
          <FieldMessage id="editExpContact_message">{supplierMessage}</FieldMessage>
        ) : null}
      </div>
      <div>
        <label htmlFor="editExpAccount" className={EDIT_LABEL}>
          Account Code
        </label>
        <select
          id="editExpAccount"
          value={accountId}
          aria-invalid={accountMessage ? true : undefined}
          aria-describedby={accountMessage ? "editExpAccount_message" : undefined}
          onChange={(e) => {
            setAccountId(e.target.value);
            setRefused(null);
          }}
          className={`${EDIT_FIELD} min-h-[44px] sm:min-h-0 ${accountMessage ? "border-flask-red-500" : "border-flask-gray-300"}`}
        >
          <option value="" disabled>
            — Select account —
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {`${a.code} ${a.name}`.trim()}
            </option>
          ))}
        </select>
        {accountMessage ? (
          <FieldMessage id="editExpAccount_message">{accountMessage}</FieldMessage>
        ) : null}
      </div>
      <div>
        <span id="editExpFiles_label" className={EDIT_LABEL}>
          Receipt/Document
        </span>
        {receipt || saved ? (
          <ReceiptRow name={receipt?.name ?? saved?.name ?? ""} onRemove={removeReceipt} />
        ) : null}
        <button
          ref={receiptBox}
          type="button"
          aria-labelledby="editExpFiles_label editExpFileText"
          aria-describedby={receiptMessage ? "editExpFiles_message" : "editExpFiles_hint"}
          onClick={() => fileInput.current?.click()}
          className={`block w-full cursor-pointer rounded-flask-lg border-2 border-dashed p-4 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-flask-focus ${
            receiptMessage
              ? "border-flask-red-500 bg-flask-gray-50 hover:bg-flask-hover"
              : receipt
                ? "border-flask-upload-ok bg-flask-upload-ok-bg"
                : "border-flask-gray-300 bg-flask-gray-50 hover:bg-flask-hover"
          }`}
        >
          <span
            id="editExpFileText"
            className="block text-sm text-flask-gray-500 [overflow-wrap:anywhere]"
          >
            {receipt
              ? uploadName(receipt.name)
              : saved
                ? "Click to change files"
                : "Click to upload"}
          </span>
          <span id="editExpFiles_hint" className="mt-1 block text-xs text-flask-gray-400">
            PDF, JPEG, PNG, HEIC (Max 10MB)
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          accept={RECEIPT_ACCEPT}
          aria-label="Choose a new receipt"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
        {receiptMessage ? (
          <FieldMessage id="editExpFiles_message">{receiptMessage}</FieldMessage>
        ) : null}
      </div>
      <div className="pt-1">
        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-flask-xl bg-flask-teal px-4 py-3 font-medium text-flask-white transition-colors hover:bg-flask-teal-hover active:bg-flask-teal-pressed disabled:opacity-70"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        {formMessage ? <FieldMessage id="editExp_message">{formMessage}</FieldMessage> : null}
      </div>
    </form>
  );

  return (
    <>
      <ExpenseDetailsModal
        line={shownLine}
        code={report.currency_code}
        // Close with changes asks "Leave without saving?" (owner, 2026-11-17; Flask discarded them)
        onClose={() => guardLeave(onClose)}
        onDismiss={dismiss}
        editor={editor}
      />
      {duplicate ? (
        <DuplicateDialog
          warning={duplicate.warning}
          code={report.currency_code}
          onSaveAnyway={() => {
            setDuplicate(null);
            duplicate.form.set(CONFIRM_DUPLICATE, "true");
            void send(duplicate.form);
          }}
          onBack={() => setDuplicate(null)}
        />
      ) : null}
    </>
  );
}
