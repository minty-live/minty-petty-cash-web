"use client";

import { fileIconInfo, requireFilePreviewHost } from "@/lib/filePreview";

/**
 * A receipt as a file row, as Bills' Add Payment lists an uploaded file (the user, 2026-11-25):
 * its icon and name, and × ("Remove <name>", 44px) when `onRemove` is given. Edit Expense and Edit
 * Details draw it for the picked file, else the saved one; no line is saved without a receipt, so
 * after × the editor refuses Save until one is attached (`RECEIPT_MISSING`).
 */
export function ReceiptRow({ name, onRemove }: { name: string; onRemove?: () => void }) {
  const { icon, iconClass } = fileIconInfo(name);
  const iconFont = requireFilePreviewHost().iconClass;
  return (
    <div className="mb-3 flex min-h-11 min-w-0 items-center gap-2 rounded-flask-lg border border-border-input bg-surface-card py-1 pl-3 pr-1">
      <span className={`${iconFont} shrink-0 ${iconClass}`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-snug text-text-primary [overflow-wrap:anywhere]">
        {name}
      </span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-flask-md text-text-muted transition-colors hover:bg-state-hover hover:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          <span className={iconFont} aria-hidden>
            close
          </span>
        </button>
      ) : null}
    </div>
  );
}
