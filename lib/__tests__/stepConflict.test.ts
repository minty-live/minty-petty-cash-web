// Two people on one report (owner's decisions doc R1/R2, 2026-11-19): reading the API's two 409s and
// the saved values each step shows.

import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/apiClient";
import type { CashCountPage, DepositPage } from "@/lib/cash";
import type { ExpensesPage } from "@/lib/expenses";
import type { OpeningPage } from "@/lib/opening";
import type { SalesPage } from "@/lib/sales";
import {
  alreadySavedOf,
  cashCountSavedRows,
  depositSavedRows,
  expensesSavedRows,
  openingSavedRows,
  reportStartedOf,
  salesSavedRows,
} from "@/lib/stepConflict";

const SAVED_BY = "This step was already saved by Sam Second at 14:05";
const STARTED = "A report for this date has already been started";
const NBSP = " ";

describe("alreadySavedOf", () => {
  it("reads R2's refusal: the sentence, the saved values and the next step", () => {
    const err = new ApiError(409, SAVED_BY, {
      error: SAVED_BY,
      saved: { a: 1 },
      next: "cash_count",
    });
    expect(alreadySavedOf(err)).toEqual({
      sentence: SAVED_BY,
      saved: { a: 1 },
      next: "cash_count",
    });
  });

  it("is null for any other refusal", () => {
    expect(alreadySavedOf(new ApiError(409, "x", { error: "x", to: "opening" }))).toBeNull();
    expect(
      alreadySavedOf(new ApiError(422, "x", { error: "x", saved: {}, next: "sales" })),
    ).toBeNull();
    expect(alreadySavedOf(new Error("offline"))).toBeNull();
  });
});

describe("reportStartedOf", () => {
  it("reads R1's refusal: the sentence, the report and its step", () => {
    const err = new ApiError(409, STARTED, { error: STARTED, report_id: "r-1", to: "sales" });
    expect(reportStartedOf(err)).toEqual({ sentence: STARTED, reportId: "r-1", to: "sales" });
  });

  it("goes to the dashboard when told, and to Opening for a step it does not know", () => {
    const body = (to: string) => ({ error: STARTED, report_id: "r-1", to });
    expect(reportStartedOf(new ApiError(409, STARTED, body("dashboard")))?.to).toBe("dashboard");
    expect(reportStartedOf(new ApiError(409, STARTED, body("later")))?.to).toBe("opening");
  });

  it("is null without a report id", () => {
    expect(reportStartedOf(new ApiError(409, "x", { error: "x", to: "dashboard" }))).toBeNull();
  });
});

describe("the saved values each step shows", () => {
  it("Opening: the addition, where it came from and the opening balance", () => {
    const saved = {
      currency_code: "HKD",
      starting_cash_balance: 100,
      cash_addition: 30,
      withdrawal: "company",
    } as OpeningPage;
    expect(openingSavedRows(saved)).toEqual([
      { label: "Addition to Cash Drawer", value: `HKD${NBSP}30.00` },
      { label: "Withdrawal from", value: "Company Bank" },
      { label: "Opening Cash Balance", value: `HKD${NBSP}130.00` },
    ]);
  });

  it("Sales: each method with an amount, then the cash", () => {
    const saved = {
      currency_code: "HKD",
      methods: [
        { sale_id: "v", name: "WeChat Pay", value_name: "w", type: "electronic", amount: 80 },
        { sale_id: "k", name: "Keeta", value_name: "k", type: "delivery", amount: null },
      ],
      cash_sales: 50,
    } as SalesPage;
    expect(salesSavedRows(saved)).toEqual([
      { label: "Wechat Pay", value: `HKD${NBSP}80.00` },
      { label: "Cash Sales", value: `HKD${NBSP}50.00` },
    ]);
  });

  it("Expenses: how many and the total", () => {
    const saved = { currency_code: "HKD", lines: [{}, {}], total: 30 } as unknown as ExpensesPage;
    expect(expensesSavedRows(saved)).toEqual([
      { label: "Expenses", value: "2" },
      { label: "Total", value: `HKD${NBSP}30.00` },
    ]);
  });

  it("Bank Deposit: the deposit", () => {
    const saved = { currency_code: "HKD", bank_deposit: 100 } as DepositPage;
    expect(depositSavedRows(saved)).toEqual([{ label: "Bank Deposit", value: `HKD${NBSP}100.00` }]);
  });

  it("Cash Count: the till, the safebox and a difference with its reason", () => {
    const saved = {
      currency_code: "HKD",
      bank_deposit: 100,
      denominations: [
        { id: "a", value: 50, kind: "note", name: null, count: 1 },
        { id: "b", value: 0.5, kind: "coin", name: null, count: 2 },
      ],
      safe_box_balance: 10,
      discrepancy: { amount: -4, kind: "short", reason: "Change given twice" },
    } as unknown as CashCountPage;
    expect(cashCountSavedRows(saved)).toEqual([
      { label: "Bank Deposit", value: `HKD${NBSP}100.00` },
      { label: "Cash Till", value: `HKD${NBSP}51.00` },
      { label: "Safebox", value: `HKD${NBSP}10.00` },
      { label: "Short", value: `HKD${NBSP}4.00` },
      { label: "Reason", value: "Change given twice" },
    ]);
  });
});
