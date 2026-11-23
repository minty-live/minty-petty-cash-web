"use client";

/**
 * The receipt reader in Add New Expense, drawn as Flask's classic page drew it
 * (`static/js/expense_ai.js`, Minty `351e942`): the read itself (`POST /reports/expenses/extract`)
 * and the pieces the card draws around its fields - the teal "Reading the receipt…" box under the
 * drop zone, the line under a suggested field with Clear, the grey note offering the receipt's
 * different reading, (owner, 2026-11-04) one quiet line when a started read fails, and (owner,
 * 2026-11-18) the "Read receipt" press - a receipt is read only on it, never on picking it - with the
 * company's AI allowance left beside it (shared with Payment Request). The rules
 * are lib/expenseAi.ts; the read and the pieces are `@minty/shared/reader`, shared with Payment
 * Request's invoice reader, here with this card's words.
 *
 * Switched off is silent (a `disabled` answer switches the reader off for the session). The API
 * logs its own failures.
 */

import {
  AllowanceNote,
  ReadButton,
  ReaderNote,
  ReadFailedLine,
  ReadingNotice as SharedReadingNotice,
  SuggestedLine as SharedSuggestedLine,
  useDocumentReader,
  type EvidenceRefusal,
  type ReaderStatus,
} from "@minty/shared/reader";

import { pettyCashFetch } from "@/lib/apiClient";
import {
  CLEAR_LABEL,
  NO_EVIDENCE,
  READ_FAILED,
  READ_LABEL,
  READING_DETAIL,
  READING_TITLE,
  RECEIPT_LATCH,
  suggestedText,
  USE_LABEL,
  type Band,
  type ExtractAnswer,
  type SuggestedField,
  type Suggestions,
} from "@/lib/expenseAi";

export { SUGGESTED_RING } from "@minty/shared/reader";

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
   * A read the API answered but refused to fill (owner, 2026-11-23): several receipts in the file,
   * or nothing describes what was paid for. Not a failure: the card says why instead.
   */
  onRefused?: (reason: EvidenceRefusal) => void,
) {
  return useDocumentReader<Suggestions>({
    field: "receipt",
    latch: RECEIPT_LATCH,
    onSuggestions,
    onStatus,
    onRefused,
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

/** A receipt that doesn't say what was paid for (owner, 2026-11-23): where the failure line would go. */
export function NoEvidenceLine() {
  return <ReadFailedLine text={NO_EVIDENCE} />;
}

const ALLOWANCE_ID = "expense_ai_allowance";

/**
 * "Read receipt": the only way a receipt is read (shown once one is picked and the reader is on),
 * with the company's AI allowance left beside it ("80% of your AI allowance left"; it stays after the read). Used up: disabled, the reason
 * beside it (a gated button shows its reason).
 */
export function ReadReceiptButton({
  onRead,
  status,
  offer,
}: {
  onRead: () => void;
  status: ReaderStatus | null;
  /** The button itself (it goes once pressed, until a read fails); the count stays. */
  offer: boolean;
}) {
  return (
    <div>
      {offer ? (
        <ReadButton
          label={READ_LABEL}
          onClick={onRead}
          disabled={!!status?.blocked}
          describedBy={ALLOWANCE_ID}
        />
      ) : null}
      <AllowanceNote id={ALLOWANCE_ID} status={status} />
    </div>
  );
}

/** While the receipt is read: Flask's teal box (QA found 12px grey text was missed; the wait is seconds). */
export function ReadingNotice() {
  return <SharedReadingNotice title={READING_TITLE} detail={READING_DETAIL} />;
}

/** The one quiet line when a started read came back with nothing. */
export function ReadFailed() {
  return <ReadFailedLine text={READ_FAILED} />;
}

/**
 * Under a suggested field: the sparkle, "<Field> suggested" (and "— please check" for the medium
 * band) and Clear. Its id goes in the field's aria-describedby, so the line is read with the field.
 */
export function SuggestedLine({
  id,
  field,
  band,
  detail,
  onClear,
}: {
  id: string;
  field: SuggestedField;
  band: Band;
  /** A sentence after it: how a receipt's amount in another currency was converted. */
  detail?: string | null;
  onClear: () => void;
}) {
  return (
    <SharedSuggestedLine
      id={id}
      text={detail ? `${suggestedText(field, band)}. ${detail}` : suggestedText(field, band)}
      clearLabel={CLEAR_LABEL}
      onClear={onClear}
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
