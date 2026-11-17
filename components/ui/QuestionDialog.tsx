"use client";

/**
 * Every yes/no question in this app on minty-web's `ConfirmDialog` (owner, 2026-11-17: questions in
 * every app use minty-web's design; forms, details and viewers keep their own frames for now).
 * Portalled to <body> in a `relative z-[250]` layer, above the sidebar drawer (z-200), marked
 * `data-leave-dialog` so `@minty/shared/leaveGuard` never holds a click inside it.
 */

import type { ComponentProps } from "react";
import { createPortal } from "react-dom";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export function QuestionDialog(props: ComponentProps<typeof ConfirmDialog>) {
  return createPortal(
    <div className="relative z-[250]" data-leave-dialog="">
      <ConfirmDialog {...props} />
    </div>,
    document.body,
  );
}
