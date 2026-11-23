/**
 * The receipt reader: what `POST /reports/expenses/extract` answers, and how its suggestions land
 * in the Add New Expense card (components/report/AddExpenseCard.tsx) - as pure functions over the
 * card's state, so the card only draws what this says. Flask's `static/js/expense_ai.js` (the
 * classic page, Minty `351e942`) is the behaviour and the wording being ported:
 *
 *   Offered      a receipt is attached, reader on       -> "Read receipt" (owner, 2026-11-18: never read on attaching),
 *                                                          with the company's AI allowance left beside it; used up ->
 *                                                          the button disabled and the reason beside it
 *   Reading      the person pressed it                  -> "Reading the receipt…"; the card stays usable
 *   Suggested    a value came back with `applied: true` -> filled in empty fields only, ringed, with
 *                "Amount suggested" ("... suggested — please check" for the medium band) and Clear
 *   Confirmed    the person changes the field          -> the marking goes
 *   Blank        low band (`applied: false`)           -> never filled; at most a note offering it
 *   Unavailable  any failure                           -> nothing at all
 *
 * Two rules the rest exists to keep (Flask's): NEVER OVERWRITE THE PERSON - a field that holds a
 * value when the answer arrives is left alone, and the receipt's different reading is only offered
 * ("Use the value from the receipt"); and ADD IS NEVER BLOCKED - the read runs beside the card,
 * and nothing is written until Add (the API writes nothing either).
 *
 * A supplier and an account are chosen only by an id from the company's lists. A name read off the
 * receipt that is not a supplier comes with the API's signed `new_supplier_token` (the user,
 * 2026-11-23): it fills the Suppliers box as a new contact, and the API adds it when the line is
 * saved - never on the read. The banding is
 * the server's (`EXPENSE_AI_CONF_*`); this side follows `band` and `applied` as they come.
 *
 * The generic half - the latch, the answer, Confirmed/Clear/Use/another receipt, the reading copy -
 * is `@minty/shared/reader` (2026-11-04), shared with Payment Request's invoice reader; what stays
 * here is this card's fields, its rules for them and its words.
 */

import { formatAmount, parseAmount } from "@minty/shared/money";
import {
  cleared as sharedCleared,
  createReaderLatch,
  edited as sharedEdited,
  readerState,
  usedNote as sharedUsedNote,
  withoutDetectedName as sharedWithoutDetectedName,
  withoutSuggestions as sharedWithoutSuggestions,
  type Band,
  type Exchange,
  type ReaderSpec,
  type ReaderState,
  type ReadField,
  type ReadNote as SharedReadNote,
} from "@minty/shared/reader";

import type { Account, Supplier } from "@/lib/expenses";
import { formatMoney } from "@/lib/money";

export type { Band, ReadField };
export {
  FAILURE_REASONS,
  READER_OFF_REASONS,
  readingCopy,
  suggestionsOf,
} from "@minty/shared/reader";

export type Suggestions = {
  supplier?: ReadField & {
    contact_id?: string;
    detected_name?: string;
    /** The detected name signed for this company: Add/Save sends it and the API adds the supplier. */
    new_supplier_token?: string;
  };
  account?: ReadField & { account_id?: string; code?: string; name?: string };
  amount?: ReadField;
  description?: ReadField;
  document_date?: ReadField;
  currency?: string;
  entity_currency?: string | null;
  /** The amount was converted from the receipt's currency (owner, 2026-11-19): how. */
  exchange?: Exchange;
  /** No rate for the receipt's currency: the amount came back empty. */
  exchange_failed?: { currency?: string };
};

/**
 * "PHP 10,000.00 Exchange Rate 0.13456" (owner, 2026-11-23): the receipt's amount in its own
 * currency and the rate used, for the description. A plain space - it is saved and sent to Xero.
 */
export function exchangeText(ex: Exchange): string {
  return `${ex.original_currency} ${formatAmount(ex.original_amount, 2)} Exchange Rate ${ex.rate}`;
}

/** No rate for the receipt's currency (owner, 2026-11-19): the amount is the person's to type. */
export function rateMissingText(currency: string, code: string | null): string {
  return code
    ? `I couldn't get an exchange rate for ${currency}. Enter the amount in ${code}.`
    : `I couldn't get an exchange rate for ${currency}. Enter the amount yourself.`;
}

/** What the extract route answers: suggestions, or null and a reason code (shown to nobody). */
export type ExtractAnswer = { suggestions: Suggestions | null; reason: string | null };

/** The fields a suggestion can fill. */
export type SuggestedField = "amount" | "supplier" | "account" | "description";

/** A supplier the receipt names and the company lacks: added by the API when the line is saved. */
export type NewSupplier = { name: string; token: string };

/**
 * The card's own values (the receipt is kept apart). A supplier or account counts once picked; a
 * read supplier the company lacks (`newSupplier`) counts while the box still holds its name.
 */
export type EntryValues = {
  amount: string;
  description: string;
  supplierText: string;
  supplier: Supplier | null;
  accountText: string;
  account: Account | null;
  newSupplier?: NewSupplier | null;
};

/** The read supplier the card will add, while the Suppliers box still holds its name. */
export function readSupplier(values: EntryValues): NewSupplier | null {
  const read = values.newSupplier;
  return !values.supplier && read && values.supplierText.trim() === read.name ? read : null;
}

/** The form field Add/Save sends the read supplier's token in (`routes/expenses.py`). */
export const NEW_SUPPLIER_TOKEN = "new_supplier_token";

/** Said with the supplier's suggested line while it is a new contact (the user, 2026-11-23). */
export const NEW_SUPPLIER_DETAIL =
  "It isn't in your contacts yet, so it's added when you save this expense.";

/** A note under a field: the receipt reads something else (or, low band, might). Nothing moves without its button. */
export type ReadNote = SharedReadNote<EntryValues>;

/** The card's values with the reader's marks, notes, touched fields and offered supplier name. */
export type EntryState = ReaderState<EntryValues, SuggestedField>;

export const EMPTY_VALUES: EntryValues = {
  amount: "",
  description: "",
  supplierText: "",
  supplier: null,
  accountText: "",
  account: null,
  newSupplier: null,
};

export function entryState(values: EntryValues = EMPTY_VALUES): EntryState {
  return readerState<EntryValues, SuggestedField>(values);
}

// ---------------------------------------------------------------------------------------------
// The session latch

/**
 * The app can't know in advance whether the reader is switched on (`EXPENSE_AI_ENABLED` is the
 * API's): it learns from a `disabled` answer, and then gets out of the way for the rest of the
 * session - no further reads, nothing shown. `not_configured` means the same thing.
 */
export const RECEIPT_LATCH = createReaderLatch("minty.pc.receipt-reader");

/** Whether the reader has said it is off in this browser session (tab). */
export const readerOff = () => RECEIPT_LATCH.readerOff();

/** Notes an answer: an off reason switches the reader off for the session. */
export const noteAnswer = (answer: { reason?: string | null } | null) =>
  RECEIPT_LATCH.noteAnswer(answer);

/** Tests only: forget the latch. */
export const resetReaderLatch = () => RECEIPT_LATCH.reset();

// ---------------------------------------------------------------------------------------------
// The words (Flask's)

const LABELS: Record<SuggestedField, string> = {
  amount: "Amount",
  supplier: "Supplier",
  account: "Account code",
  description: "Description",
};

const FIELD_NAMES: Record<SuggestedField, string> = {
  amount: "amount",
  supplier: "supplier",
  account: "account",
  description: "description",
};

/** The line under a suggested field: medium is marked more strongly for checking. */
export function suggestedText(field: SuggestedField, band: Band): string {
  return band === "medium"
    ? `${LABELS[field]} suggested — please check`
    : `${LABELS[field]} suggested`;
}

/** Clear's accessible name. */
export const CLEAR_LABEL = "Clear the suggested value for this field";

/** The note's button. */
export const USE_LABEL = "Use the value from the receipt";

/** The press that reads the receipt (owner, 2026-11-18). */
export const READ_LABEL = "Read receipt";

/** The reading notice (Flask's words). */
export const READING_TITLE = "Reading the receipt…";
export const READING_DETAIL =
  "This can take a few seconds. You can start typing now if you prefer.";

/** The one quiet failure line (owner, 2026-11-04; Part 11: the issue, then the action). */
export const READ_FAILED = "I couldn't read this receipt. Enter the details yourself.";

/** A card terminal slip alone (owner, 2026-11-19): the API fills nothing and the card says why. */
export const REASON_CARD_SLIP = "card_slip_only";
export const CARD_SLIP =
  "A card slip alone is not valid evidence. Please attach a receipt that shows what was bought.";

const hedge = (band: Band) => (band === "low" ? "might read" : "reads");

// ---------------------------------------------------------------------------------------------
// The rules

const emptyText = (text: string) => text.trim() === "";
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sameAmount = (a: string, b: string) =>
  Math.abs((parseAmount(a) ?? 0) - (parseAmount(b) ?? 0)) < 0.005;

/**
 * The receipt's amount as plain digits: the reader may send it with currency letters, a symbol or
 * spaces ("HKD 448.80", "$ 1,200"), which the shared formatter would refuse - only the digits, the
 * point and a minus are kept (a minus keeps a negative reading out).
 */
const receiptAmount = (raw: string) => raw.replace(/[^\d.-]/g, "");

/** More than a week between the receipt's date and the report's day: said, never blocking. */
export function dateNote(date: ReadField | undefined, day: string): string {
  if (!date?.applied || !date.value) return "";
  const receipt = Date.parse(date.value);
  const report = Date.parse(day);
  if (Number.isNaN(receipt) || Number.isNaN(report)) return "";
  if (Math.abs(receipt - report) / 86_400_000 <= 7) return "";
  return `Note: this receipt is dated ${date.value}, which is more than a week from the report date.`;
}

/**
 * The card after an answer: each applied suggestion fills its field when the field is empty
 * (and marks it); a reading that differs from what is already there - or a low-band one for an
 * empty field - becomes a note with "Use the value from the receipt"; an unknown supplier name is
 * offered for New Contact. Previous suggestions are expected to be gone already (`withoutSuggestions`).
 */
export function withSuggestions(
  state: EntryState,
  s: Suggestions,
  {
    suppliers,
    accounts,
    code,
    day,
    canCreateSupplier,
  }: {
    suppliers: Supplier[];
    accounts: Account[];
    code: string | null;
    day: string;
    canCreateSupplier: boolean;
  },
): EntryState {
  const values = { ...state.values };
  const marks = { ...state.marks };
  const notes = { ...state.notes };
  let detectedName: string | null = null;
  const filled: SuggestedField[] = [];

  const fill = (field: SuggestedField, patch: Partial<EntryValues>, band: Band) => {
    Object.assign(values, patch);
    marks[field] = band;
    delete notes[field];
    filled.push(field);
  };

  // The amount.
  const amount = s.amount;
  const read = amount?.value ? receiptAmount(amount.value) : "";
  const shown = formatAmount(read);
  const readValue = parseAmount(read) ?? 0;
  if (amount && shown && readValue > 0) {
    if (amount.applied && emptyText(values.amount)) fill("amount", { amount: shown }, amount.band);
    else if (emptyText(values.amount))
      notes.amount = {
        text: `The receipt ${hedge(amount.band)} ${formatMoney(readValue, code)}.`,
        fill: { amount: shown },
        band: amount.band,
      };
    else if (!sameAmount(values.amount, read))
      notes.amount = {
        text: `The receipt ${hedge(amount.band)} ${formatMoney(readValue, code)}, not ${formatMoney(parseAmount(values.amount) ?? 0, code)}.`,
        fill: { amount: shown },
        band: amount.band,
      };
  }

  // The description: filled only, never argued with (Flask's rule). A converted amount this read
  // filled adds its currency and rate after it (owner, 2026-11-23): "Taxi · PHP 10,000.00 Exchange
  // Rate 0.13456" - or the conversion alone when nothing was read.
  const description = s.description;
  const said = description?.applied && description.value ? description.value : "";
  const conversion = s.exchange && filled.includes("amount") ? exchangeText(s.exchange) : "";
  const text = [said, conversion].filter(Boolean).join(" · ");
  if (text && emptyText(values.description))
    fill("description", { description: text }, said ? description!.band : "medium");

  // The supplier: by its id from the company's list only.
  const supplier = s.supplier;
  const supplierEmpty = !values.supplier && emptyText(values.supplierText);
  const known = supplier?.contact_id
    ? (suppliers.find((x) => x.id === supplier.contact_id) ?? null)
    : null;
  if (supplier && known) {
    const patch = { supplier: known, supplierText: known.name, newSupplier: null };
    const current = (values.supplier?.name ?? values.supplierText).trim();
    if (supplier.applied && supplierEmpty) fill("supplier", patch, supplier.band);
    else if (supplierEmpty)
      notes.supplier = {
        text: `The receipt ${hedge(supplier.band)} like "${known.name}".`,
        fill: patch,
        band: supplier.band,
      };
    else if (!sameText(current, known.name))
      notes.supplier = {
        text: `The receipt ${hedge(supplier.band)} like "${known.name}", not "${current}".`,
        fill: patch,
        band: supplier.band,
      };
  } else if (supplier?.detected_name?.trim() && supplierEmpty) {
    // not on the list: the name goes straight into the Suppliers box (owner, 2026-11-23) and, with
    // the API's signed token, is added when the line is saved - by anyone who may add the line
    // (the user, 2026-11-23); nothing is created here. Without a token (an older API) the box's own
    // "+ Add" makes it a supplier, for those who may add one.
    const name = supplier.detected_name.trim();
    const token = supplier.new_supplier_token ?? "";
    if (token) {
      detectedName = name;
      fill(
        "supplier",
        { supplier: null, supplierText: name, newSupplier: { name, token } },
        "medium",
      );
    } else if (canCreateSupplier) {
      detectedName = name;
      fill("supplier", { supplier: null, supplierText: name, newSupplier: null }, "medium");
    }
  }

  // The account: by its id from the company's expense accounts only.
  const account = s.account;
  const chosen = account?.account_id
    ? (accounts.find((a) => a.id === account.account_id) ?? null)
    : null;
  if (account && chosen) {
    const patch = { account: chosen, accountText: chosen.name };
    const accountEmpty = !values.account && emptyText(values.accountText);
    const current = (values.account?.name ?? values.accountText).trim();
    if (account.applied && accountEmpty) fill("account", patch, account.band);
    else if (accountEmpty)
      notes.account = {
        text: `The receipt ${hedge(account.band)} like "${chosen.name}".`,
        fill: patch,
        band: account.band,
      };
    else if (values.account?.id !== chosen.id && !sameText(current, chosen.name))
      notes.account = {
        text: `The receipt ${hedge(account.band)} more like "${chosen.name}" than "${current}".`,
        fill: patch,
        band: account.band,
      };
  }

  // One announcement, not several: a live region written twice quickly may be read once.
  const parts: string[] = [];
  if (filled.length) {
    parts.push(
      `Suggestions from the receipt filled ${filled.length} ${filled.length === 1 ? "field" : "fields"}: ${filled.map((f) => FIELD_NAMES[f]).join(", ")}. Please check them before adding.`,
    );
  }
  const differing = (Object.keys(notes) as SuggestedField[]).filter(
    (f) => notes[f] && !state.notes[f],
  );
  if (differing.length)
    parts.push(
      `The receipt reads differently for: ${differing.map((f) => FIELD_NAMES[f]).join(", ")}. Nothing has been changed.`,
    );
  if (detectedName)
    parts.push(
      values.newSupplier
        ? `The receipt names a supplier that is not in your list: ${detectedName}. It is added as a new contact when you save this expense.`
        : `The receipt names a supplier that is not in your list: ${detectedName}. It is in the Suppliers box for you to add or change.`,
    );
  if (s.exchange && filled.includes("amount"))
    parts.push(
      `The amount was converted from ${s.exchange.original_currency} ${s.exchange.original_amount}.`,
    );
  if (s.exchange_failed?.currency) parts.push(rateMissingText(s.exchange_failed.currency, code));
  const date = dateNote(s.document_date, day);
  if (date && parts.length) parts.push(date);

  return { ...state, values, marks, notes, detectedName, announcement: parts.join(" ") };
}

const CLEARED: Record<SuggestedField, Partial<EntryValues>> = {
  amount: { amount: "" },
  supplier: { supplier: null, supplierText: "", newSupplier: null },
  account: { account: null, accountText: "" },
  description: { description: "" },
};

const SPEC: ReaderSpec<EntryValues, SuggestedField> = {
  cleared: (field) => CLEARED[field],
  // The amount grouped on blur ("45" -> "45.00") is the same amount: the field keeps its marking
  // and its note - leaving the field to press "Use the value from the receipt" must not withdraw it.
  same: (field, before, after) =>
    field === "amount" &&
    !emptyText(after.amount) &&
    !emptyText(before.amount) &&
    sameAmount(after.amount, before.amount),
};

/**
 * The person changed a field: it is theirs now (Confirmed) - its marking and its note go, and for
 * the supplier the offered name too. A change to the same value (the amount grouped on blur) is no change.
 */
export const edited = (state: EntryState, field: SuggestedField, patch: Partial<EntryValues>) =>
  sharedEdited(state, field, patch, SPEC, "supplier");

/** Clear: a suggested field's value goes with its marking (only ever for a field still marked). */
export const cleared = (state: EntryState, field: SuggestedField) =>
  sharedCleared(state, field, SPEC);

/** "Use the value from the receipt": the note's value goes in, marked as suggested. */
export const usedNote = (state: EntryState, field: SuggestedField) => sharedUsedNote(state, field);

/** The offered supplier name was taken to New Contact (or set aside): the offer goes. */
export const withoutDetectedName = (state: EntryState) => sharedWithoutDetectedName(state);

/**
 * Another receipt (or none): the old one's suggestions go entirely - the VALUES of fields still
 * marked too, or the never-overwrite rule would protect stale suggestions as if typed. Fields the
 * person changed are unmarked already and stay as they are.
 */
export const withoutSuggestions = (state: EntryState) => sharedWithoutSuggestions(state, SPEC);

/** Whether an answer showed the person anything (a filled field, a note, an offered supplier). */
export const showedAnything = (state: EntryState) =>
  Object.keys(state.marks).length > 0 ||
  Object.keys(state.notes).length > 0 ||
  state.detectedName !== null;
