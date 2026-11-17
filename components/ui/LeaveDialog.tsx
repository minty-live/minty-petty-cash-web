"use client";

// COPY of minty-web/components/ui/LeaveDialog.tsx (here 2026-11-17, from minty-payment-request-web's InterruptedDialogs.tsx)
// - lifted into @minty/shared at Part 3 step 4; change every copy (minty-web, minty-payment-request-web, here).
// One local change: it is drawn through QuestionDialog (portalled above the sidebar drawer, `data-leave-dialog`).

/**
 * "Leave without saving?" (Figma A-11, on the `ConfirmDialog` shell): changes not saved yet, and
 * the person goes somewhere. "Discard changes" puts the saved state back and goes on; "Go Back",
 * Escape and the backdrop only close the dialog - so the safe answer sits in the CONFIRM slot and
 * the destructive one in the back slot, deliberately.
 *
 * Here: Edit Details on a report's summary and step pages (owner, 2026-11-17). What asks is
 * `@minty/shared/leaveGuard`, through `useUnsavedEdits` in components/report/ReportEdits.tsx.
 */

import { QuestionDialog } from "@/components/ui/QuestionDialog";

export const LEAVE_TITLE = "Leave without saving?";
export const LEAVE_BODY_1 = "You have unsaved changes.";
export const LEAVE_BODY_2 = "Your changes will be lost if you leave this page.";
export const DISCARD_CHANGES = "Discard changes";
export const GO_BACK_UPPER = "Go Back";

export function LeaveDialog({ onDiscard, onStay }: { onDiscard: () => void; onStay: () => void }) {
  return (
    <QuestionDialog
      title={<span data-modal="leave">{LEAVE_TITLE}</span>}
      image="dont"
      busy={false}
      confirmLabel={GO_BACK_UPPER}
      confirmTone="teal"
      backLabel={DISCARD_CHANGES}
      backTone="teal"
      onConfirm={onStay}
      onBack={onDiscard}
      onDismiss={onStay}
    >
      <p>{LEAVE_BODY_1}</p>
      <p>{LEAVE_BODY_2}</p>
    </QuestionDialog>
  );
}
