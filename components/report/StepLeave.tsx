"use client";

import { useState, type ReactNode } from "react";

import { useLeaveGuard } from "@minty/shared/leaveGuard";

import { LeaveDialog } from "@/components/ui/LeaveDialog";

/**
 * The report wizard's unsaved changes (owner, 2026-11-17: Figma 515:597, option B). While a step
 * holds input not saved yet, every way out - the stepper, the header's Back, the menu's links, the
 * browser's Back - asks "Leave without saving?" in the page (`@minty/shared/leaveGuard`), in place
 * of Flask's stepper-only toast. Go Back stays with the typing; Discard changes goes on (the page
 * leaves, so there is nothing to put back). Save & Next and Save & Exit save first, so they never
 * ask. A reload or a closed tab leaves without asking (no native browser dialog). The returned
 * node goes in the page's overlays.
 */
export function useStepLeave(dirty: boolean): ReactNode {
  const [discarded, setDiscarded] = useState(false);
  const guard = useLeaveGuard(dirty && !discarded, () => setDiscarded(true));
  return guard.open ? <LeaveDialog onDiscard={guard.discard} onStay={guard.stay} /> : null;
}
