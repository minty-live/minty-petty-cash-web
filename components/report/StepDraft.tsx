"use client";

import { useState, type ReactNode } from "react";

import { useAutoSaveDraft } from "@minty/shared/drafts";
import { DraftRestore } from "@minty/shared/ui";

import { currentDraftScope } from "@/lib/draftScope";

/**
 * The report wizard's auto-saved drafts (the owner's decisions doc L1; the user's choices,
 * 2026-11-20): what a step holds is kept IN THIS BROWSER 2 seconds after the last change
 * (`@minty/shared/drafts`), never in the report - only the person's own Save & Next or Save & Exit
 * writes that. Coming back to the step, the values are put back at once (`onRestore`), with no
 * notice and nothing asked (`DraftRestore`; the user, 2026-11-24). Files too large to keep are
 * simply not among the restored ones.
 *
 * `basedOn` is the report's `edit_version` (`reportVersion`), shared by the whole report: any
 * step's save since the draft was taken makes it stale, and a stale draft is dropped silently,
 * never put back. The step calls `clear` once its own save has succeeded (before it moves on) and
 * from its leave-guard's Discard changes (`useStepLeave`); an R2 409 (someone saved the step first)
 * keeps the draft, which is dropped as stale after a reload.
 */
export function useStepDraft<T>({
  form,
  record,
  basedOn,
  value,
  dirty,
  ready = true,
  files,
  onRestore,
}: {
  form: string;
  record: string;
  basedOn: string | null;
  value: T;
  dirty: boolean;
  ready?: boolean;
  files?: readonly File[];
  onRestore: (value: T, files: File[]) => void;
}): { restorer: ReactNode; clear: () => void } {
  const [scope] = useState(currentDraftScope);
  const draft = useAutoSaveDraft<T>({
    scope,
    form,
    record,
    shape: 1,
    ready,
    basedOn,
    value,
    dirty,
    files,
  });
  const offer = draft.offer;
  // keyed by the record, so a draft for another record (Expenses' cards) acts again
  const restorer = offer ? (
    <DraftRestore
      key={`${form}:${record}`}
      stale={offer.stale}
      onRestore={() => {
        const taken = draft.restore();
        if (taken) onRestore(taken.value, taken.files);
      }}
      onDiscard={draft.discard}
    />
  ) : null;
  return { restorer, clear: draft.clear };
}

/** A report's `edit_version` as a draft's `basedOn`: "none" before the day has a report. */
export function reportVersion(editVersion: number | null | undefined): string {
  return String(editVersion ?? "none");
}
