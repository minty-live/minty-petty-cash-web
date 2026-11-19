/**
 * The duplicate reminder (owner's decisions doc DUP1, 2026-11-19; Minty petty-cash-api): just before
 * an expense line is saved, the API answers 409 `{error, duplicates: [{id, description, amount,
 * supplier}]}` when another line of the day has the same supplier and amount, and saves nothing.
 * The person can save anyway - the same form again with `confirm_duplicate=true` - so the warning
 * never blocks. Other 409s (no draft for the day, ...) carry no `duplicates`.
 */

import { ApiError } from "@/lib/apiClient";

/** One line the API found with the same day, supplier and amount (`amount` a decimal string). */
export type DuplicateLine = {
  id: string;
  description: string | null;
  amount: string;
  supplier: string | null;
};

export type DuplicateWarning = { sentence: string; duplicates: DuplicateLine[] };

/** The form field that saves the line anyway. */
export const CONFIRM_DUPLICATE = "confirm_duplicate";

/** DUP1's refusal - the API's sentence and the matching lines - or null for any other error. */
export function duplicatesOf(err: unknown): DuplicateWarning | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as { error?: unknown; duplicates?: unknown } | null;
  if (!body || !Array.isArray(body.duplicates) || body.duplicates.length === 0) return null;
  return {
    sentence: typeof body.error === "string" ? body.error : err.message,
    duplicates: body.duplicates as DuplicateLine[],
  };
}
