"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { QuestionDialog } from "@/components/ui/QuestionDialog";
import type { SavedRow } from "@/lib/stepConflict";

type Shown = { sentence: string; rows: SavedRow[]; href: string };

/**
 * A step's R2 handling: `show` opens the dialog with the sentence, the saved values and the next
 * step's address; `dialog` goes in the page's overlays.
 */
export function useAlreadySaved(): {
  dialog: ReactNode;
  show: (sentence: string, rows: SavedRow[], href: string) => void;
} {
  const router = useRouter();
  const [shown, setShown] = useState<Shown | null>(null);
  return {
    dialog: shown ? (
      <AlreadySavedDialog
        sentence={shown.sentence}
        rows={shown.rows}
        onContinue={() => router.push(shown.href)}
      />
    ) : null,
    show: (sentence, rows, href) => setShown({ sentence, rows, href }),
  };
}

/**
 * Someone else saved this step first (owner's decisions doc R2, 2026-11-19; `lib/stepConflict.ts`):
 * the API's sentence ("This step was already saved by {name} at {time}"), the values they saved,
 * and one way on - Continue, to the next step. Nothing typed here was saved. On minty-web's
 * `ConfirmDialog` as a one-button notice, like Setup Required.
 */
export function AlreadySavedDialog({
  sentence,
  rows,
  onContinue,
}: {
  sentence: string;
  rows: SavedRow[];
  onContinue: () => void;
}) {
  return (
    <QuestionDialog
      title="Already saved"
      image="dont"
      busy={false}
      hideBack
      confirmLabel="Continue"
      onConfirm={onContinue}
      onBack={onContinue}
      onDismiss={onContinue}
    >
      <p role="status">{sentence}</p>
      {rows.length ? (
        <dl className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.label} className="flex min-w-0 flex-wrap justify-between gap-x-4">
              <dt>{row.label}</dt>
              <dd className="m-0 min-w-0 font-semibold [overflow-wrap:anywhere]">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </QuestionDialog>
  );
}
