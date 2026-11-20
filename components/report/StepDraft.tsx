"use client";

import { useState, type ReactNode } from "react";

import { useAutoSaveDraft } from "@minty/shared/drafts";
import { DraftNotice } from "@minty/shared/ui";

import { parseMoney } from "@/lib/currencyInput";
import { currentDraftScope } from "@/lib/draftScope";
import { formatMoney } from "@/lib/money";

/**
 * The report wizard's auto-saved drafts (the owner's decisions doc L1; the user's choices,
 * 2026-11-20): what a step holds is kept IN THIS BROWSER 2 seconds after the last change
 * (`@minty/shared/drafts`), never in the report - only the person's own Save & Next or Save & Exit
 * writes that. Coming back to the step, the notice asks first: "You have unsaved changes from
 * 10:42." - Restore puts the values back (`onRestore`), Discard throws them away.
 *
 * `basedOn` is the report's `edit_version` (`reportVersion`), shared by the whole report: any
 * step's save since the draft was taken makes it stale, and a stale draft is only shown (Show what
 * I typed, `describe`), never put back. The step calls `clear` once its own save has succeeded
 * (before it moves on) and from its leave-guard's Discard changes (`useStepLeave`); an R2 409
 * (someone saved the step first) keeps the draft, which comes back stale after a reload.
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
  describe,
}: {
  form: string;
  record: string;
  basedOn: string | null;
  value: T;
  dirty: boolean;
  ready?: boolean;
  files?: readonly File[];
  onRestore: (value: T, files: File[]) => void;
  /** The draft as label/value rows, amounts written as the step shows them. */
  describe: (value: T) => { label: string; value: string }[];
}): { notice: ReactNode; clear: () => void } {
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
  const notice = offer ? (
    <DraftNotice
      className="mb-4"
      savedAt={offer.savedAt}
      stale={offer.stale}
      missing={offer.missing}
      onRestore={() => {
        const taken = draft.restore();
        if (taken) onRestore(taken.value, taken.files);
      }}
      onDiscard={draft.discard}
      describe={() => describe(offer.value)}
    />
  ) : null;
  return { notice, clear: draft.clear };
}

/** A report's `edit_version` as a draft's `basedOn`: "none" before the day has a report. */
export function reportVersion(editVersion: number | null | undefined): string {
  return String(editVersion ?? "none");
}

/** A typed amount as the steps write it (`HKD 1,200.50`), or nothing for an empty field. */
export function typedMoney(typed: string | undefined, code: string | null): string {
  return typed ? formatMoney(parseMoney(typed), code) : "";
}
