"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";

import { useAmountInput } from "@minty/shared/amountInput";

import { useToast } from "@/components/flask/Toasts";
import {
  CardSlipLine,
  ReadFailed,
  ReadingNotice,
  ReadReceiptButton,
  ReceiptNote,
  SUGGESTED_RING,
  SuggestedLine,
  useReceiptReader,
} from "@/components/report/ReceiptReader";
import { DuplicateDialog } from "@/components/report/DuplicateDialog";
import { ReceiptViewer, type ShownReceipt } from "@/components/report/ReceiptViewer";
import { FieldMessage } from "@/components/report/ReportChrome";
import { ApiError, pettyCashFetch } from "@/lib/apiClient";
import { parseMoney } from "@/lib/currencyInput";
import { CONFIRM_DUPLICATE, duplicatesOf, type DuplicateWarning } from "@/lib/duplicates";
import {
  cleared,
  edited,
  entryState,
  rateMissingText,
  readerOff,
  usedNote,
  withoutDetectedName,
  showedAnything,
  withoutSuggestions,
  withSuggestions,
  type EntryState,
  type EntryValues,
  type SuggestedField,
} from "@/lib/expenseAi";
import {
  lineEdits,
  missingFields,
  newContactProblem,
  receiptKind,
  receiptProblem,
  searchAccounts,
  searchSuppliers,
  uploadName,
  type Account,
  type ExpenseLine,
  type RequiredField,
  type Supplier,
} from "@/lib/expenses";
import { descriptionProblem } from "@/lib/report";
import {
  AiCaution,
  convertedText,
  exchangeFailedOf,
  exchangeFields,
  exchangeKept,
  exchangeOf,
  type Exchange,
  type ReaderStatus,
} from "@minty/shared/reader";

const FIELD =
  "w-full rounded-flask-2xl border bg-flask-white py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-flask-focus cursor-pointer";
const LABEL = "mb-2 block text-sm font-medium text-flask-gray-700";
const OUTLINE_BUTTON =
  "flex flex-1 items-center justify-center gap-2 rounded-flask-xl border-2 border-flask-secondary-edge px-4 py-3 font-medium text-flask-secondary-ink transition-colors hover:bg-flask-teal-soft";
const FILLED_BUTTON =
  "flex flex-1 items-center justify-center gap-2 rounded-flask-xl bg-flask-teal px-4 py-3 font-medium text-flask-white transition-colors hover:bg-flask-teal-hover active:bg-flask-teal-pressed disabled:opacity-70";
const ADD_FAILED = "An error occurred while adding the expense. Please try again.";
const EDIT_FAILED = "An error occurred while updating the expense. Please try again.";

/** A saved line as the card's values, for Edit Expense. */
function lineValues(line: ExpenseLine): EntryValues {
  return {
    amount: line.amount.toFixed(2),
    description: line.description ?? "",
    supplierText: line.supplier?.name ?? "",
    supplier: line.supplier,
    accountText: line.account?.name ?? "",
    account: line.account,
  };
}

const Star = () => (
  <>
    <span className="text-flask-red-500" aria-hidden="true">
      *
    </span>
    <span className="sr-only">(required)</span>
  </>
);

/** The sentence a refusal carried, or null when the API gave none (Flask's `fromServer`). */
function sentenceOf(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as { error?: unknown } | null;
  return body && typeof body.error === "string" ? body.error : null;
}

/** What the page can ask of an open card (`ref`). */
export type AddExpenseHandle = {
  /**
   * The card's own Add (Save, editing a line), as its button does: true once the line is saved
   * (`onAdded`/`onSaved` have run), false on any refusal - the card keeps its messages and
   * questions (missing fields, DUP1's duplicate question, the server's sentence).
   */
  submit: () => Promise<boolean>;
};

export type AddExpenseProps = {
  /** The step's Save & Next / Save & Exit with this card open (plan item 3, 2026-11-20). */
  ref?: Ref<AddExpenseHandle>;
  day: string;
  code: string | null;
  suppliers: Supplier[];
  accounts: Account[];
  canCreateSupplier: boolean;
  /**
   * The receipt reader's status (the page's `reader`, then each read's): switched on, a picked
   * receipt offers "Read receipt" with the company's AI allowance left; used up, the button is disabled.
   */
  reader: ReaderStatus | null;
  /** A read's answer carried the company's new allowance: the page keeps it for every card. */
  onReaderStatus: (status: ReaderStatus) => void;
  /** A supplier made here, for the page's list (Flask pushes it onto `allContacts`). */
  onSupplierCreated: (supplier: Supplier) => void;
  onAdded: (line: ExpenseLine, total: number) => void;
  /** Edit Expense: the saved draft line the card opens filled in with; Save changes it in place. */
  line?: ExpenseLine | null;
  /** Edit Expense: the line as the API answers it after Save, with the new total. */
  onSaved?: (line: ExpenseLine, total: number) => void;
  onCancel: () => void;
  /** Whether the card holds input not saved yet - the wizard asks before leaving it (2026-11-17). */
  onDirty?: (dirty: boolean) => void;
  /** A restored auto-saved draft (2026-11-20): the card opens with these values and receipt. */
  start?: { values: EntryValues; file: File | null } | null;
  /** Each change to the typed values or the picked receipt, for the page's auto-saved draft. */
  onEntry?: (values: EntryValues, file: File | null) => void;
  /** The phone card's overlay: its text while something is sent, null when done. */
  setBusy: (text: string | null) => void;
  /** The API found no draft for the day: back to Opening with its sentence. */
  onNoDraft: (sentence: string) => void;
};

/**
 * Flask's "Add New Expense" card (`#addExpenseForm` in `report/expense.html`), inline below the
 * list: the receipt drop zone, Expense Amount, Description, the searchable Suppliers dropdown with
 * its "New Contact" panel, the Account Code dropdown, and Cancel / Add. Add checks the four
 * required fields as Flask does (red borders and one toast), then sends the line with its receipt
 * as one multipart `POST /reports/expenses/lines`; the server checks it all again.
 *
 * A picked receipt can be read (components/report/ReceiptReader.tsx, `POST /reports/expenses/extract`)
 * - only when the person presses "Read receipt", never on picking it (owner, 2026-11-18): its
 * suggestions fill only empty fields, ringed and marked, and the card never waits for it.
 *
 * With `line` it is "Edit Expense" (owner, 2026-11-16): the same card filled in from a saved draft
 * line, its receipt named in the drop zone. Save sends only what changed as one multipart
 * `PATCH /expense-lines/{id}` (a picked file replaces the line's receipt); nothing changed just
 * closes it.
 *
 * Either save may come back as DUP1's 409 (another line of the day with the same supplier and
 * amount; `lib/duplicates.ts`): `DuplicateDialog` asks, Go back keeps the card as typed, and Save
 * anyway sends the same form again with `confirm_duplicate=true`.
 *
 * The step's Save & Next / Save & Exit can press Add (Save) for the person through `ref`'s
 * `submit` - its "Add it and continue" (components/report/ExpensesStep.tsx).
 */
export function AddExpenseCard(props: AddExpenseProps) {
  const {
    day,
    code,
    suppliers,
    accounts,
    canCreateSupplier,
    reader: readerStatus,
    onReaderStatus,
    onSupplierCreated,
    onAdded,
    line = null,
    onSaved,
    onCancel,
    onDirty,
    start = null,
    onEntry,
    setBusy,
    onNoDraft,
    ref,
  } = props;
  const editing = line !== null;
  const toast = useToast();
  const card = useRef<HTMLFormElement>(null);
  // the four typed fields, with the receipt reader's marks and notes on them (lib/expenseAi.ts)
  const [entry, setEntry] = useState<EntryState>(() =>
    entryState(start ? start.values : line ? lineValues(line) : undefined),
  );
  const { amount, description, supplierText, supplier, accountText, account } = entry.values;
  const change = (field: SuggestedField, patch: Partial<EntryValues>) =>
    setEntry((state) => edited(state, field, patch));
  const amountInput = useAmountInput({
    value: amount,
    onValue: (v) => {
      change("amount", { amount: v });
      clearError("amount");
    },
  });
  const descriptionField = useRef<HTMLInputElement>(null);
  const descriptionMessage = descriptionProblem(description);
  // The card's latest state, for the answer that arrives seconds after the read started.
  const entryRef = useRef(entry);
  useEffect(() => {
    entryRef.current = entry;
  }, [entry]);
  // a read filled the card: the owner's caution stays under the fields until the line is saved
  // (2026-11-19); another receipt takes it away with the old suggestions
  const [aiFilled, setAiFilled] = useState(false);
  // a receipt in another currency (owner, 2026-11-19): the read's conversion and the figure it
  // gave - kept with the line only while the amount still holds that figure - or the currency no
  // rate was found for
  const [exchange, setExchange] = useState<{ how: Exchange; converted: string } | null>(null);
  const [rateMissing, setRateMissing] = useState<string | null>(null);
  // a card terminal slip alone (owner, 2026-11-19): nothing filled, and the card says why
  const [cardSlip, setCardSlip] = useState(false);
  const reader = useReceiptReader(
    (suggestions) => {
      const next = withSuggestions(entryRef.current, suggestions, {
        suppliers,
        accounts,
        code,
        day,
        canCreateSupplier,
      });
      entryRef.current = next;
      setEntry(next);
      const how = exchangeOf(suggestions);
      setExchange(
        how && suggestions.amount?.value ? { how, converted: suggestions.amount.value } : null,
      );
      const missing = exchangeFailedOf(suggestions);
      setRateMissing(missing);
      const showed = showedAnything(next) || missing !== null;
      if (showed) setAiFilled(true);
      return showed;
    },
    onReaderStatus,
    day,
    () => setCardSlip(true),
  );
  // the receipt and an object URL of it, made when it is picked and let go when it is replaced
  const [picked, setPicked] = useState<Picked | null>(() =>
    start?.file ? { file: start.file, url: URL.createObjectURL(start.file) } : null,
  );
  const pickedRef = useRef<Picked | null>(picked);
  useEffect(() => () => revoke(pickedRef.current), []);
  const file = picked?.file ?? null;
  // "Read receipt" was pressed for this receipt: the button goes, and comes back after a failed read
  const [readAsked, setReadAsked] = useState(false);
  // (and never once a `disabled` answer has switched the reader off for the session)
  const offerRead =
    readerStatus?.enabled === true &&
    file !== null &&
    !reader.reading &&
    (!readAsked || reader.failed) &&
    !readerOff();
  // input not saved yet: a saved line's fields changed or a new receipt; a new line's anything typed
  const holdsInput =
    file !== null ||
    (line
      ? Object.keys(lineEdits(line, { amount, description, supplier, account })).length > 0
      : [amount, description, supplierText, accountText].some((v) => (v ?? "").trim() !== ""));
  const onDirtyRef = useRef(onDirty);
  useEffect(() => {
    onDirtyRef.current = onDirty;
  });
  useEffect(() => {
    onDirtyRef.current?.(holdsInput);
  }, [holdsInput]);
  useEffect(() => () => onDirtyRef.current?.(false), []);
  const onEntryRef = useRef(onEntry);
  useEffect(() => {
    onEntryRef.current = onEntry;
  });
  useEffect(() => {
    onEntryRef.current?.(entry.values, file);
  }, [entry.values, file]);
  const [newContact, setNewContact] = useState<string | null>(null);
  const newContactField = useRef<HTMLInputElement>(null);
  const newContactMessage = newContact === null ? null : newContactProblem(newContact);
  const [errors, setErrors] = useState<Set<RequiredField>>(new Set());
  const [sending, setSending] = useState(false);
  // DUP1: the API found a line like this one; the question is open until Go back or Save anyway
  const [duplicate, setDuplicate] = useState<{
    warning: DuplicateWarning;
    again: () => void;
  } | null>(null);

  // Flask scrolls the card into view as it opens.
  useEffect(() => {
    const timer = window.setTimeout(
      () => card.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      100,
    );
    return () => window.clearTimeout(timer);
  }, []);

  const clearError = (field: RequiredField) =>
    setErrors((all) => {
      if (!all.has(field)) return all;
      const next = new Set(all);
      next.delete(field);
      return next;
    });

  function pickSupplier(s: Supplier) {
    change("supplier", { supplier: s, supplierText: s.name });
    clearError("supplier");
  }

  function pickAccount(a: Account) {
    change("account", { account: a, accountText: a.name });
    clearError("account");
  }

  // the conversion holds while the amount is still the converted figure
  const converted = exchange && exchangeKept(amount, exchange.converted) ? exchange.how : null;
  const convertedDetail = converted
    ? `${convertedText(converted, code).replace(/^c/, "C")}.`
    : null;

  /** A field holding the reader's suggestion: its ring, the line under it, or the note offering another reading. */
  function readerExtras(field: SuggestedField, inputId: string) {
    const band = entry.marks[field];
    const note = entry.notes[field];
    return (
      <>
        {band ? (
          <SuggestedLine
            id={`${inputId}_suggested`}
            field={field}
            band={band}
            detail={field === "amount" ? convertedDetail : null}
            onClear={() => {
              setEntry((state) => cleared(state, field));
              document.getElementById(inputId)?.focus();
            }}
          />
        ) : null}
        {note ? (
          <ReceiptNote
            text={note.text}
            onAction={() => setEntry((state) => usedNote(state, field))}
          />
        ) : null}
      </>
    );
  }
  const suggested = (field: SuggestedField) => (entry.marks[field] ? SUGGESTED_RING : "");
  const describedBy = (field: SuggestedField, inputId: string, ...others: (string | null)[]) =>
    [entry.marks[field] ? `${inputId}_suggested` : null, ...others].filter(Boolean).join(" ") ||
    undefined;

  async function createSupplier() {
    if (newContactMessage) {
      newContactField.current?.focus();
      return;
    }
    const name = (newContact ?? "").trim();
    setNewContact(name);
    if (!name) {
      toast("Who should I put down as the contact?", "error");
      return;
    }
    setBusy("Creating Contact...");
    try {
      const made = await pettyCashFetch<Supplier>("/suppliers", { method: "POST", json: { name } });
      onSupplierCreated(made);
      pickSupplier(made);
      setNewContact(null);
      toast("That contact's added!", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      toast(sentenceOf(err) ?? "I couldn't add that contact. Mind trying again?", "error");
    } finally {
      setBusy(null);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  /** Add (Save, editing): true once the line is saved, false on a refusal. */
  async function submit(): Promise<boolean> {
    if (sending) return false;
    if (descriptionMessage) {
      descriptionField.current?.focus();
      return false;
    }
    // a saved line keeps its receipt unless another is picked
    const keepsReceipt = line !== null && line.receipts.length > 0;
    const missing = missingFields({
      amount,
      supplierText,
      supplier,
      accountText,
      account,
      file,
    }).filter((field) => !(field === "file" && keepsReceipt && !file));
    setErrors(new Set(missing));
    if (missing.length > 0 || !supplier || !account || (!file && !keepsReceipt)) {
      toast("Please fill out the Required Fields", "error");
      return false;
    }
    // what is on the card is what is sent: a reading still out is dropped
    reader.cancel();
    if (line) return save(line, file);
    if (!file) return false;
    const form = new FormData();
    form.append("transaction_date", day);
    form.append("amount", String(parseMoney(amount)));
    form.append("description", description);
    form.append("supplier_id", supplier.id);
    form.append("account_id", account.id);
    form.append("receipt", file, file.name);
    if (converted)
      for (const [name, value] of Object.entries(exchangeFields(converted)))
        form.append(name, value);
    return sendNew(form);
  }

  useImperativeHandle(ref, () => ({ submit }));

  /** DUP1's 409 (`lib/duplicates.ts`): ask, and Save anyway sends `form` again with the flag. */
  function askDuplicate(err: unknown, form: FormData, send: (form: FormData) => Promise<unknown>) {
    const warning = duplicatesOf(err);
    if (!warning) return false;
    setDuplicate({
      warning,
      again: () => {
        form.set(CONFIRM_DUPLICATE, "true");
        void send(form);
      },
    });
    return true;
  }

  /** Add's multipart `POST /reports/expenses/lines`: true once the line is added. */
  async function sendNew(form: FormData): Promise<boolean> {
    setSending(true);
    setBusy("Saving...");
    try {
      const answer = await pettyCashFetch<{ line: ExpenseLine; total: number }>(
        "/reports/expenses/lines",
        { method: "POST", form },
      );
      setBusy(null);
      onAdded(answer.line, answer.total);
      toast("Expense added successfully!", "success");
      return true;
    } catch (err) {
      setBusy(null);
      setSending(false);
      if (err instanceof ApiError && err.status === 401) return false;
      if (askDuplicate(err, form, sendNew)) return false;
      const body = err instanceof ApiError ? (err.body as { to?: string } | null) : null;
      if (body?.to === "opening") {
        onNoDraft(err instanceof ApiError ? err.message : ADD_FAILED);
        return false;
      }
      toast(sentenceOf(err) ?? ADD_FAILED, "error");
      return false;
    }
  }

  /** Edit Expense's Save: only the changed fields, and a picked file as the new receipt. */
  async function save(saved: ExpenseLine, newReceipt: File | null): Promise<boolean> {
    const changes = lineEdits(saved, { amount, description, supplier, account });
    if (Object.keys(changes).length === 0 && !newReceipt) {
      onCancel();
      return true;
    }
    const form = new FormData();
    for (const [name, value] of Object.entries(changes)) form.append(name, value);
    if (newReceipt) form.append("receipt", newReceipt, newReceipt.name);
    // a new receipt's conversion goes with its amount (a changed amount without it clears the old one)
    if (converted) {
      if (!form.has("amount")) form.append("amount", String(parseMoney(amount)));
      for (const [name, value] of Object.entries(exchangeFields(converted)))
        form.append(name, value);
    }
    return sendEdit(saved, form);
  }

  /** Edit Expense's multipart `PATCH /expense-lines/{id}`: true once the line is saved. */
  async function sendEdit(saved: ExpenseLine, form: FormData): Promise<boolean> {
    setSending(true);
    setBusy("Saving...");
    try {
      const answer = await pettyCashFetch<{ line: ExpenseLine; total: number }>(
        `/expense-lines/${encodeURIComponent(saved.id)}`,
        { method: "PATCH", form },
      );
      setBusy(null);
      onSaved?.(answer.line, answer.total);
      toast("Expense updated successfully!", "success");
      return true;
    } catch (err) {
      setBusy(null);
      setSending(false);
      if (err instanceof ApiError && err.status === 401) return false;
      if (askDuplicate(err, form, (again) => sendEdit(saved, again))) return false;
      const body = err instanceof ApiError ? (err.body as { to?: string } | null) : null;
      if (body?.to === "opening") {
        onNoDraft(err instanceof ApiError ? err.message : EDIT_FAILED);
        return false;
      }
      toast(sentenceOf(err) ?? EDIT_FAILED, "error");
      return false;
    }
  }

  // a field holding a suggestion has a value, so it is not red whatever a refused Add said before
  const invalid = (field: RequiredField) =>
    errors.has(field) && !(field !== "file" && entry.marks[field]);
  const border = (field: RequiredField) =>
    invalid(field) ? "border-flask-red-500" : "border-flask-gray-300";

  return (
    <form
      ref={card}
      noValidate
      onSubmit={add}
      className="mb-6 rounded-flask-lg bg-flask-white p-6 shadow-flask-sm"
      aria-labelledby="addExpenseTitle"
    >
      <h2 id="addExpenseTitle" className="mb-6 text-xl font-bold text-flask-gray-900">
        {editing ? "Edit Expense" : "Add New Expense"}
      </h2>

      <ReceiptDrop
        picked={picked}
        kept={line && line.receipts.length > 0 ? line.receipts[0].name : null}
        invalid={errors.has("file")}
        onFile={(f) => {
          revoke(pickedRef.current);
          const next = f ? { file: f, url: URL.createObjectURL(f) } : null;
          pickedRef.current = next;
          setPicked(next);
          // the old receipt's suggestions go with it; what the person typed stays
          setEntry(withoutSuggestions);
          setAiFilled(false);
          setExchange(null);
          setRateMissing(null);
          setCardSlip(false);
          // read only on "Read receipt" (owner, 2026-11-18)
          reader.cancel();
          setReadAsked(false);
          if (f) clearError("file");
        }}
      >
        {reader.reading ? <ReadingNotice /> : null}
        {reader.failed && !reader.reading ? <ReadFailed /> : null}
        {cardSlip && !reader.reading ? <CardSlipLine /> : null}
        {readerStatus?.enabled === true && file !== null && !readerOff() ? (
          <ReadReceiptButton
            status={readerStatus}
            offer={offerRead}
            onRead={() => {
              setCardSlip(false);
              setReadAsked(true);
              void reader.read(file);
            }}
          />
        ) : null}
      </ReceiptDrop>
      <div role="status" aria-live="polite" className="sr-only">
        {entry.announcement}
      </div>

      <div className="mb-4">
        <label htmlFor="expense_amount" className={LABEL}>
          Expense Amount <Star />
        </label>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <span className="text-sm text-flask-gray-500">{code}</span>
          </div>
          <input
            id="expense_amount"
            autoComplete="off"
            placeholder="0.00"
            aria-required="true"
            aria-invalid={invalid("amount") || undefined}
            aria-describedby={describedBy("amount", "expense_amount")}
            {...amountInput}
            className={`${FIELD} ${border("amount")} ${suggested("amount")} pl-12 pr-3 text-flask-black`}
          />
        </div>
        {readerExtras("amount", "expense_amount")}
        {rateMissing && !amount.trim() ? (
          <p role="status" className="mt-1.5 break-words text-sm text-text-secondary">
            {rateMissingText(rateMissing, code)}
          </p>
        ) : null}
      </div>

      <div className="mb-4">
        <label htmlFor="expense_description" className={LABEL}>
          Description
        </label>
        <input
          ref={descriptionField}
          id="expense_description"
          type="text"
          autoComplete="off"
          placeholder="Description (Optional)"
          value={description}
          aria-invalid={descriptionMessage ? true : undefined}
          aria-describedby={describedBy(
            "description",
            "expense_description",
            descriptionMessage ? "expense_description_message" : null,
          )}
          onChange={(e) => change("description", { description: e.target.value })}
          className={`${FIELD} ${descriptionMessage ? "border-flask-red-500" : "border-flask-gray-300"} ${suggested("description")} pl-3 pr-3 text-flask-gray-700`}
        />
        {descriptionMessage ? (
          <FieldMessage id="expense_description_message">{descriptionMessage}</FieldMessage>
        ) : null}
        {readerExtras("description", "expense_description")}
      </div>

      {newContact === null ? (
        <div className="mb-4">
          <SearchField
            id="expense_contact"
            label={
              <>
                Suppliers <Star />
              </>
            }
            placeholder="Select a contact"
            text={supplierText}
            invalid={invalid("supplier")}
            className={suggested("supplier")}
            describedBy={describedBy("supplier", "expense_contact")}
            onText={(text) => {
              change("supplier", {
                supplierText: text,
                ...(supplier && text.trim() !== supplier.name ? { supplier: null } : {}),
              });
              clearError("supplier");
            }}
            listFor={(text, how) => {
              if (how === "click" || !text.trim()) {
                // the note from the moment the list opens (owner, 2026-11-12; onboarding's wording),
                // so it opens even before the company has a supplier
                const all = supplierOptions(
                  searchSuppliers(suppliers, "").matches,
                  null,
                  pickSupplier,
                  setNewContact,
                );
                const list = canCreateSupplier ? [CONTACT_HINT_ROW, ...all] : all;
                return list.length > 0 ? list : null;
              }
              const { matches, offerNew } = searchSuppliers(suppliers, text);
              const offer = canCreateSupplier ? offerNew : null;
              if (matches.length > 0)
                return supplierOptions(matches, offer, pickSupplier, setNewContact);
              return noSupplierOptions(offer, setNewContact);
            }}
          />
          {readerExtras("supplier", "expense_contact")}
          {entry.detectedName ? (
            <ReceiptNote
              text={`Receipt says "${entry.detectedName}", which is not in your supplier list.`}
              action={`Add "${entry.detectedName}" as a new supplier`}
              onAction={() => {
                // it fills the New Contact box; Create stays the person's own press
                setNewContact(entry.detectedName);
                setEntry(withoutDetectedName);
              }}
            />
          ) : null}
        </div>
      ) : (
        <div className="mb-4 rounded-flask-xl border border-flask-gray-300 bg-flask-white p-6 shadow-flask-lg">
          <label htmlFor="new_contact" className={LABEL}>
            New Contact <Star />
          </label>
          <input
            ref={newContactField}
            id="new_contact"
            type="text"
            autoComplete="off"
            placeholder="Enter a New Contact"
            aria-required="true"
            aria-invalid={newContactMessage ? true : undefined}
            aria-describedby={newContactMessage ? "new_contact_message" : undefined}
            value={newContact}
            onChange={(e) => setNewContact(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createSupplier();
              }
            }}
            className={`${FIELD} ${newContactMessage ? "border-flask-red-500" : "border-flask-gray-300"} pl-3 pr-3 text-flask-gray-700`}
          />
          {newContactMessage ? (
            <FieldMessage id="new_contact_message">{newContactMessage}</FieldMessage>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setNewContact(null);
                change("supplier", { supplierText: "", supplier: null });
              }}
              className="flex-1 rounded-flask-xl border-2 border-flask-secondary-edge px-4 py-2 text-sm font-medium text-flask-secondary-ink transition-colors hover:bg-flask-teal-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createSupplier()}
              className="flex-1 rounded-flask-xl bg-flask-teal px-4 py-2 text-sm font-medium text-flask-white transition-colors hover:bg-flask-teal-hover active:bg-flask-teal-pressed"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="mb-4">
        <SearchField
          id="expense_account_code"
          label={
            <>
              Account Code <Star />
            </>
          }
          placeholder="Select an account code"
          text={accountText}
          invalid={invalid("account")}
          className={suggested("account")}
          describedBy={describedBy("account", "expense_account_code")}
          onText={(text) => {
            change("account", {
              accountText: text,
              ...(account && text.trim() !== account.name ? { account: null } : {}),
            });
            clearError("account");
          }}
          listFor={(text, how) => {
            const list = how === "click" ? accounts : searchAccounts(accounts, text);
            return list.length > 0 ? accountOptions(list, pickAccount) : null;
          }}
        />
        {readerExtras("account", "expense_account_code")}
      </div>

      {aiFilled ? <AiCaution id={AI_CAUTION_ID} exchange={converted !== null} /> : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => {
            reader.cancel();
            onCancel();
          }}
          className={OUTLINE_BUTTON}
        >
          <span>Cancel</span>
        </button>
        <button
          type="submit"
          disabled={sending}
          aria-describedby={aiFilled ? AI_CAUTION_ID : undefined}
          className={FILLED_BUTTON}
        >
          <span>{editing ? "Save" : "Add"}</span>
        </button>
      </div>
      {/* portalled to <body>: outside the form in the page, so it never submits it */}
      {duplicate ? (
        <DuplicateDialog
          warning={duplicate.warning}
          code={code}
          onSaveAnyway={() => {
            setDuplicate(null);
            duplicate.again();
          }}
          onBack={() => setDuplicate(null)}
        />
      ) : null}
    </form>
  );
}

const AI_CAUTION_ID = "expense_ai_caution";

/* ---------- the two dropdowns ---------- */

type Option = { key: string; content: ReactNode; className: string; pick?: () => void };

const ITEM = "cursor-pointer px-4 py-2 hover:bg-flask-hover";

/** A supplier list's note, shown as it opens (onboarding's "Type a contact name..."). */
const CONTACT_HINT_ROW: Option = {
  key: "hint",
  className: "border-b border-flask-gray-100 px-4 py-2 text-xs text-flask-gray-500",
  content: <div>Type a contact name to add a new contact</div>,
};

function supplierOptions(
  matches: Supplier[],
  offerNew: string | null,
  pick: (s: Supplier) => void,
  offer: (name: string) => void,
): Option[] {
  const options: Option[] = matches.map((s, i) => ({
    key: s.id,
    // every row ruled off but the last contact (Flask: border-b, none before the "+ Add" row)
    className: `${ITEM} ${i < matches.length - 1 ? "border-b border-flask-gray-100" : ""}`,
    content: <div className="text-sm font-medium text-flask-gray-900">{s.name}</div>,
    pick: () => pick(s),
  }));
  if (offerNew) {
    options.push({
      key: "add-new",
      className: `${ITEM} border-t border-flask-gray-200`,
      content: (
        <div className="text-flask-gray-600 hover:text-flask-gray-800">
          + Add &apos;{offerNew}&apos; as a new contact
        </div>
      ),
      pick: () => offer(offerNew),
    });
  }
  return options;
}

function noSupplierOptions(offerNew: string | null, offer: (name: string) => void): Option[] {
  const options: Option[] = [
    {
      key: "none",
      className: `px-4 py-2 text-flask-gray-600 ${offerNew ? "border-b border-flask-gray-100" : ""}`,
      content: <div className="text-sm">No contact found</div>,
    },
  ];
  if (offerNew) {
    options.push({
      key: "add-new",
      className: ITEM,
      content: (
        <div className="text-flask-gray-600 hover:text-flask-gray-800">
          + Add &apos;{offerNew}&apos; as a new contact
        </div>
      ),
      pick: () => offer(offerNew),
    });
  }
  return options;
}

function accountOptions(list: Account[], pick: (a: Account) => void): Option[] {
  return list.map((a, i) => ({
    key: a.id,
    className: `${ITEM} ${i < list.length - 1 ? "border-b border-flask-gray-100" : ""}`,
    content: (
      <>
        <div className="text-sm font-medium text-flask-gray-900">{a.name}</div>
        <div className="text-xs text-flask-gray-500">{a.code}</div>
      </>
    ),
    pick: () => pick(a),
  }));
}

/**
 * Flask's searchable dropdown field (`#expense_contact`, `#expense_account_code`): a text input with
 * a chevron that turns over while the list is open. A click lists everything; typing filters; a
 * focus with text filters; leaving closes it (after 200ms, as Flask does). ↑/↓ move through the
 * rows that can be picked, Enter picks the highlighted one or the first, Escape closes.
 */
function SearchField({
  id,
  label,
  placeholder,
  text,
  invalid,
  className = "",
  describedBy,
  onText,
  listFor,
}: {
  id: string;
  label: ReactNode;
  placeholder: string;
  text: string;
  invalid: boolean;
  /** Extra classes on the input (the receipt reader's ring). */
  className?: string;
  describedBy?: string;
  onText: (text: string) => void;
  /** The rows for `text`, or null for a closed list. */
  listFor: (text: string, how: "click" | "typed") => Option[] | null;
}) {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [active, setActive] = useState(-1);
  const blurTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(blurTimer.current), []);

  const open = options !== null;
  const pickable = (options ?? []).filter((o) => o.pick);
  const show = (next: Option[] | null) => {
    setOptions(next);
    setActive(-1);
  };

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || pickable.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % pickable.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? pickable.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickable[active < 0 ? 0 : active].pick?.();
      show(null);
    } else if (e.key === "Escape") {
      e.preventDefault();
      show(null);
    }
  }

  const listId = `${id}_list`;
  const activeOption = active >= 0 ? pickable[active] : undefined;
  return (
    <>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-required="true"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-activedescendant={activeOption ? `${listId}_${activeOption.key}` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          onClick={() => show(listFor("", "click"))}
          onChange={(e) => {
            onText(e.target.value);
            show(listFor(e.target.value, "typed"));
          }}
          onFocus={() => {
            window.clearTimeout(blurTimer.current);
            if (text.trim()) show(listFor(text, "typed"));
          }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => show(null), 200);
          }}
          onKeyDown={onKeyDown}
          className={`${FIELD} ${invalid ? "border-flask-red-500" : "border-flask-gray-300"} ${className} pl-3 pr-10 text-flask-gray-700 placeholder:text-flask-gray-700`}
        />
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
          <svg
            className={`h-5 w-5 text-flask-gray-400 transition-transform duration-200 ease-in-out ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        {open ? (
          <div
            id={listId}
            role="listbox"
            className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-flask-lg border border-flask-gray-300 bg-flask-white shadow-flask-lg"
          >
            {options.map((o) => {
              const highlighted = o === activeOption;
              return (
                <div
                  key={o.key}
                  id={`${listId}_${o.key}`}
                  role={o.pick ? "option" : "presentation"}
                  aria-selected={o.pick ? highlighted : undefined}
                  ref={(el) => {
                    if (el && highlighted)
                      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
                  }}
                  className={`${o.className} ${highlighted ? "bg-flask-hover" : ""}`}
                  onMouseDown={(e) => {
                    // keep the focus in the input, so its blur does not close the list first
                    e.preventDefault();
                    if (!o.pick) return;
                    o.pick();
                    show(null);
                  }}
                >
                  {o.content}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </>
  );
}

/* ---------- the receipt drop zone ---------- */

type Picked = { file: File; url: string };

function revoke(picked: Picked | null) {
  if (picked) URL.revokeObjectURL(picked.url);
}

const UPLOAD_ICON =
  "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12";
const DONE_ICON = "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z";

/**
 * Flask's `#uploadArea`: a dashed box to click or drop a receipt on, PDF / JPEG / PNG up to 10MB.
 * With a picture it shows the picture (borderless, 256 x 192); with a PDF it turns green and names
 * it. The expand button in its corner opens the picked file full screen. `children` sit right
 * under the box (the receipt reader's "Reading the receipt…", where Flask put it).
 */
function ReceiptDrop({
  picked,
  kept = null,
  invalid,
  onFile,
  children,
}: {
  picked: Picked | null;
  /** Edit Expense: the saved receipt's name, shown until another file is picked. */
  kept?: string | null;
  invalid: boolean;
  onFile: (file: File | null) => void;
  children?: ReactNode;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<ShownReceipt | null>(null);
  const file = picked?.file ?? null;
  const url = picked?.url ?? null;
  const kind = file ? receiptKind(file.type, file.name) : null;

  function take(files: File[], how: "picked" | "dropped") {
    if (files.length === 0) return; // the picker was cancelled: the file stays
    const problem = receiptProblem(files, how);
    if (problem) {
      toast(problem, "error");
      // Flask's picker clears what was there; a refused drop leaves it be
      if (how === "picked") onFile(null);
      return;
    }
    onFile(files[0]);
  }

  const isFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  let look: string;
  if (dragging) look = "border-2 border-dashed border-flask-blue-500 bg-flask-blue-50 p-6";
  else if (file && kind === "image") look = "border-0 bg-transparent p-0";
  else if (file || kept)
    look = "border-2 border-dashed border-flask-upload-ok bg-flask-upload-ok-bg p-6";
  else
    look = `border-2 border-dashed ${invalid ? "border-flask-red-500" : "border-flask-gray-300"} bg-flask-gray-50 p-6 hover:bg-flask-hover`;

  return (
    <div className="mb-6">
      <span id="receipt_label" className={LABEL}>
        Receipt/Document <Star />
      </span>
      <div
        role="button"
        tabIndex={0}
        aria-labelledby="receipt_label"
        aria-describedby="receipt_hint"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (isFiles(e)) setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (isFiles(e)) {
            setDragging(true);
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(Array.from(e.dataTransfer.files), "dropped");
        }}
        className={`relative cursor-pointer overflow-hidden rounded-flask-md text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-flask-focus ${look}`}
      >
        <button
          type="button"
          aria-label="Preview receipt"
          disabled={!file || !url}
          onClick={(e) => {
            e.stopPropagation();
            if (file && url && kind) setViewing({ url, kind, name: file.name });
          }}
          className={`absolute bottom-2 right-2 z-10 rounded-full bg-flask-white p-2 shadow-flask-sm ${
            file && url
              ? "cursor-pointer text-flask-gray-500 hover:text-flask-gray-500/80"
              : "cursor-not-allowed text-flask-gray-400 opacity-50"
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            className="size-6 transition-colors"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
            />
          </svg>
        </button>

        {file && kind === "image" && url && !dragging ? (
          <div className="m-0 p-0 leading-[0]">
            {/* eslint-disable-next-line @next/next/no-img-element -- an object URL of the picked file */}
            <img
              src={url}
              alt="Uploaded receipt"
              className="mx-auto h-48 w-64 max-w-full object-contain"
            />
            <span id="receipt_hint" className="sr-only">
              Click to change files
            </span>
          </div>
        ) : (
          <>
            <svg
              className={`mx-auto mb-4 h-12 w-12 ${(file || kept) && !dragging ? "text-flask-upload-ok" : "text-flask-gray-400"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              {(file || kept) && !dragging ? (
                <path strokeLinecap="round" strokeLinejoin="round" d={DONE_ICON} />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d={UPLOAD_ICON}
                />
              )}
            </svg>
            {file && !dragging ? (
              <>
                <p className="text-sm font-medium text-flask-upload-ok [overflow-wrap:anywhere]">
                  &quot;{uploadName(file.name)}&quot; Uploaded
                </p>
                <p id="receipt_hint" className="mt-1 text-xs text-flask-gray-500">
                  Click to change files
                </p>
              </>
            ) : kept && !dragging ? (
              <>
                <p className="text-sm font-medium text-flask-upload-ok [overflow-wrap:anywhere]">
                  &quot;{uploadName(kept)}&quot; Attached
                </p>
                <p id="receipt_hint" className="mt-1 text-xs text-flask-gray-500">
                  Click to change files
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-flask-gray-700">
                  Click to upload or drag and drop
                </p>
                <p id="receipt_hint" className="mt-1 text-xs text-flask-gray-500">
                  PDF, JPEG, PNG (Max 10MB)
                </p>
              </>
            )}
          </>
        )}
        <input
          ref={input}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png"
          data-testid="expense_files"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            take(Array.from(e.target.files ?? []), "picked");
            e.target.value = "";
          }}
        />
      </div>
      {children}
      {viewing ? <ReceiptViewer receipt={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
