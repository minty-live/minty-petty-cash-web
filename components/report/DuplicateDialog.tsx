"use client";

import { QuestionDialog } from "@/components/ui/QuestionDialog";
import type { DuplicateWarning } from "@/lib/duplicates";
import { formatMoney } from "@/lib/money";

/**
 * The duplicate reminder (owner's decisions doc DUP1, 2026-11-19; `lib/duplicates.ts`): the API's
 * sentence and each line of the day with the same supplier and amount (description · supplier ·
 * amount), then Go back (nothing saved, the form stays as typed) or Save anyway (the same save
 * again with `confirm_duplicate`). It never blocks. On minty-web's `ConfirmDialog`.
 */
export function DuplicateDialog({
  warning,
  code,
  onSaveAnyway,
  onBack,
}: {
  warning: DuplicateWarning;
  code: string | null;
  onSaveAnyway: () => void;
  onBack: () => void;
}) {
  return (
    <QuestionDialog
      title="Save it anyway?"
      image="dont"
      busy={false}
      confirmLabel="Save anyway"
      onConfirm={onSaveAnyway}
      onBack={onBack}
    >
      <p>{warning.sentence}</p>
      <ul className="flex flex-col gap-2">
        {warning.duplicates.map((d) => (
          <li key={d.id} className="min-w-0 [overflow-wrap:anywhere]">
            {[d.description?.trim() || "No description", d.supplier, money(d.amount, code)]
              .filter(Boolean)
              .join(" · ")}
          </li>
        ))}
      </ul>
    </QuestionDialog>
  );
}

function money(amount: string, code: string | null): string {
  const value = Number(amount);
  return Number.isFinite(value) ? formatMoney(value, code) : amount;
}
