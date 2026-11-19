/**
 * Two people on one report (owner's decisions doc R1/R2, 2026-11-19; Minty petty-cash-api
 * `routes/opening.py`, `sales.py`, `expenses.py`, `cash.py`).
 *
 * R1 - two people starting the same day: the first creates the report; the second's Opening save is
 * 409 `{error: "A report for this date has already been started", report_id, to}` and nothing of
 * theirs is written. They are taken to that report (`to`: its step, or the dashboard).
 *
 * R2 - two people saving the same step: every step's read answers `edit_version` and its save
 * carries it back. A save from an older version is 409 `{error: "This step was already saved by
 * {name} at {time}", saved, next}`: the page shows the sentence and the saved values, then goes on
 * to `next`. Expense lines never carry a version (two people's lines both stay).
 */

import { ApiError } from "@/lib/apiClient";
import type { CashCountPage, DepositPage } from "@/lib/cash";
import { tillTotal } from "@/lib/cash";
import type { ExpensesPage } from "@/lib/expenses";
import { formatMoney } from "@/lib/money";
import type { OpeningPage } from "@/lib/opening";
import { flaskLabel, partsOf, type SalesPage } from "@/lib/sales";
import { sectionStep, type WizardStep } from "@/lib/wizardPages";

export type StepAlreadySaved<T> = { sentence: string; saved: T; next: WizardStep };

/** R2's refusal - the sentence, the step's saved values and the step to go on to - or null. */
export function alreadySavedOf<T>(err: unknown): StepAlreadySaved<T> | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as { error?: unknown; saved?: unknown; next?: unknown } | null;
  if (!body || typeof body.error !== "string" || !body.saved || typeof body.next !== "string")
    return null;
  return { sentence: body.error, saved: body.saved as T, next: sectionStep(body.next) };
}

/** R1's refusal - the sentence and where that report is (`dashboard`, or its step) - or null. */
export function reportStartedOf(
  err: unknown,
): { sentence: string; reportId: string; to: WizardStep | "dashboard" } | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as { error?: unknown; report_id?: unknown; to?: unknown } | null;
  if (!body || typeof body.error !== "string" || typeof body.report_id !== "string") return null;
  return {
    sentence: body.error,
    reportId: body.report_id,
    to: body.to === "dashboard" ? "dashboard" : sectionStep(String(body.to ?? "")),
  };
}

/** One line of the saved values: the field's label as the step shows it, and what was saved. */
export type SavedRow = { label: string; value: string };

export function openingSavedRows(saved: OpeningPage): SavedRow[] {
  const code = saved.currency_code;
  const addition = saved.cash_addition ?? 0;
  return [
    { label: "Addition to Cash Drawer", value: formatMoney(addition, code) },
    {
      label: "Withdrawal from",
      value: saved.withdrawal === "company" ? "Company Bank" : "Personal",
    },
    {
      label: "Opening Cash Balance",
      value: formatMoney(saved.starting_cash_balance + addition, code),
    },
  ];
}

export function salesSavedRows(saved: SalesPage): SavedRow[] {
  const code = saved.currency_code;
  const rows = saved.methods
    .filter((m) => m.amount)
    .map((m) => ({ label: flaskLabel(m.name), value: formatMoney(m.amount ?? 0, code) }));
  if (partsOf(saved).cash)
    rows.push({ label: "Cash Sales", value: formatMoney(saved.cash_sales ?? 0, code) });
  return rows;
}

export function expensesSavedRows(saved: ExpensesPage): SavedRow[] {
  return [
    { label: "Expenses", value: String(saved.lines.length) },
    { label: "Total", value: formatMoney(saved.total, saved.currency_code) },
  ];
}

export function depositSavedRows(saved: DepositPage): SavedRow[] {
  return [{ label: "Bank Deposit", value: formatMoney(saved.bank_deposit, saved.currency_code) }];
}

export function cashCountSavedRows(saved: CashCountPage): SavedRow[] {
  const code = saved.currency_code;
  const counts = Object.fromEntries(saved.denominations.map((d) => [d.id, d.count]));
  const rows: SavedRow[] = [
    { label: "Bank Deposit", value: formatMoney(saved.bank_deposit, code) },
    { label: "Cash Till", value: formatMoney(tillTotal(saved.denominations, counts), code) },
    { label: "Safebox", value: formatMoney(saved.safe_box_balance, code) },
  ];
  const { kind, amount, reason } = saved.discrepancy;
  if (kind !== "none") {
    rows.push({
      label: kind === "short" ? "Short" : "Over",
      value: formatMoney(Math.abs(amount), code),
    });
    if (reason) rows.push({ label: "Reason", value: reason });
  }
  return rows;
}
