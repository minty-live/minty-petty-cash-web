"use client";

/**
 * The receipt reader in Add New Expense, drawn as Flask's classic page drew it
 * (`static/js/expense_ai.js`, Minty `351e942`): the read itself (`POST /reports/expenses/extract`)
 * and the pieces the card draws around its fields. The user, 2026-11-26: a receipt is read as soon
 * as it is attached (no "Read receipt" press, which the owner had asked for on 2026-11-18), with the
 * reading cat in the drop zone's place; a failed read says why, with Try again (twice) and Fill in
 * manually; nothing about how much allowance is left, only the reason once it is used up (the
 * receipt is then taken but not read). Also the line under a suggested field with Clear and the
 * grey note offering the receipt's different reading. The rules are lib/expenseAi.ts; the read and
 * the pieces are `@minty/shared/reader`, shared with Payment Request's invoice reader, here with
 * this card's words.
 *
 * Switched off says "Minty isn't available for this company yet." once, then nothing is read for
 * the session (a `disabled` answer latches the reader off). The API logs its own failures.
 */

import {
  AllowanceNote,
  PLEASE_CHECK,
  ReaderNote,
  ReadFailedNotice,
  readFailureText,
  ReadingCat,
  readingCatSize,
  SuggestedLine as SharedSuggestedLine,
  useDocumentReader,
  type DocumentWarning,
  type EvidenceRefusal,
  type ReadFailure,
  type ReaderStatus,
} from "@minty/shared/reader";

import { pettyCashFetch } from "@/lib/apiClient";
import {
  CLEAR_LABEL,
  RECEIPT_LATCH,
  suggestedText,
  USE_LABEL,
  type Band,
  type ExtractAnswer,
  type SuggestedField,
  type Suggestions,
} from "@/lib/expenseAi";

export { outlineRing } from "@minty/shared/reader";

export const EXTRACT_PATH = "/reports/expenses/extract";

/**
 * One read at a time: a new receipt, Cancel, Add or closing the card cancels the one in flight,
 * and an answer for a receipt no longer there is dropped. `onSuggestions` returns whether the
 * answer showed anything; nothing shown is the quiet failure line.
 */
export function useReceiptReader(
  onSuggestions: (suggestions: Suggestions) => boolean | void,
  onStatus?: (status: ReaderStatus) => void,
  /** The report's day: the rate's day when a receipt in another currency has none (owner, 2026-11-19). */
  day?: string,
  /**
   * A read the API answered but refused to fill: several receipts in the file - the only refusal
   * (the user, 2026-11-25). Not a failure: the card says why instead.
   */
  onRefused?: (reason: EvidenceRefusal) => void,
  /** What the receipt may be instead (the user, 2026-11-24), or null after each read: a warning only. */
  onWarning?: (warning: DocumentWarning | null) => void,
) {
  return useDocumentReader<Suggestions>({
    field: "receipt",
    latch: RECEIPT_LATCH,
    onSuggestions,
    onStatus,
    onRefused,
    onWarning,
    post: async (form, signal) => {
      if (day) form.append("transaction_date", day);
      return pettyCashFetch<ExtractAnswer>(EXTRACT_PATH, {
        method: "POST",
        form,
        signal,
        onUnauthorized: "reject",
      });
    },
  });
}

const ALLOWANCE_ID = "expense_ai_allowance";

/**
 * A receipt is read as soon as it is attached (the user, 2026-11-26: no "Read receipt" button, no
 * "% of your AI allowance left"). Once the company's allowance is used up the receipt is still
 * taken but not read, and this says why ("Your company has used its AI allowance…", or "AI
 * reading is paused until {date}…"); otherwise it draws nothing.
 */
export function ReaderBlockedNote({ status }: { status: ReaderStatus | null }) {
  return <AllowanceNote id={ALLOWANCE_ID} status={status} />;
}

/**
 * While the receipt is read: the reading cat in the receipt box's place (the user, 2026-11-26;
 * `ReceiptDrop`'s `busy`) - the same cat for everyone, "Minty is reading your receipt…" in the
 * person's first day of reading, "Reading…" after.
 */
export function ReadingInBox({ status }: { status: ReaderStatus | null }) {
  return <ReadingCat size={readingCatSize(status)} document="receipt" place="zone" />;
}

/**
 * Why a started read came back with nothing (the user, 2026-11-26), with Try again while the
 * receipt has tries left and Fill in manually.
 */
export function ReadFailed({
  failure,
  canRetry,
  onRetry,
  onManual,
}: {
  failure: ReadFailure;
  canRetry: boolean;
  onRetry: () => void;
  onManual: () => void;
}) {
  return (
    <ReadFailedNotice
      text={readFailureText(failure, "receipt", canRetry)}
      onRetry={canRetry ? onRetry : undefined}
      onManual={onManual}
    />
  );
}

/**
 * Under a suggested field: the sparkle, "<Field> suggested" (and "— please check" for the medium
 * band) and Clear. Its id goes in the field's aria-describedby, so the line is read with the field.
 * `check`: the field is outlined orange, and the line says "Please check" in the warning ink (the
 * user, 2026-11-25).
 */
export function SuggestedLine({
  id,
  field,
  band,
  detail,
  check = false,
  onClear,
}: {
  id: string;
  field: SuggestedField;
  band: Band;
  /** A sentence after it: how a receipt's amount in another currency was converted. */
  detail?: string | null;
  check?: boolean;
  onClear: () => void;
}) {
  const said = check ? PLEASE_CHECK : suggestedText(field, band);
  return (
    <SharedSuggestedLine
      id={id}
      text={detail ? `${said}. ${detail}` : said}
      clearLabel={CLEAR_LABEL}
      onClear={onClear}
      tone={check ? "check" : "suggested"}
    />
  );
}

/**
 * Flask's grey note with one action: the receipt reads something else, or names a supplier that is
 * not on the list. The text came off a receipt image: drawn as text, never as markup.
 */
export function ReceiptNote({
  text,
  action = USE_LABEL,
  onAction,
}: {
  text: string;
  action?: string;
  onAction: () => void;
}) {
  return <ReaderNote text={text} action={action} onAction={onAction} />;
}
