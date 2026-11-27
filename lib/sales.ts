/**
 * The Sales step's read: what `GET /reports/sales` answers (Minty `petty_cash_api/routes/sales.py`),
 * and the page's labels and totals as Flask's `report/sales.html` works them out.
 */

import type { OpeningPage } from "@/lib/opening";
import { parseMoney } from "@/lib/currencyInput";

export type SalesMethod = {
  sale_id: string;
  /** The catalogue's name ("WeChat Pay"); the page shows {@link flaskLabel} of it. */
  name: string;
  /** The key the save sends the amount under ("wechat_sales"). */
  value_name: string;
  type: "electronic" | "delivery";
  /** The day's amount; null when the report has none for this method. */
  amount: number | null;
};

/**
 * How the company's methods are grouped (owner, 2026-11-11; the API's `sales_groups`): one Non-cash
 * section for a retail shop, a service or a general business; Electronic and Delivery for Restaurant
 * & Food and a company from before onboarding asked. An answer without it is the second.
 */
export type SalesGroups = "non_cash" | "electronic_delivery";

export type SalesPage = {
  transaction_date: string;
  currency_code: string | null;
  /** null before Opening made the day's draft. */
  draft: OpeningPage["draft"];
  /** The version the save carries back (R2; `lib/stepConflict.ts`). Absent from an older API. */
  edit_version?: number | null;
  /** The company's electronic and delivery methods, in Settings order. */
  methods: SalesMethod[];
  cash_sales: number | null;
  groups?: SalesGroups;
  /** The parts the company takes - onboarding's ticked sales accounts (owner, 2026-11-17). Absent
   * from an older API: every part. */
  parts?: SalesParts;
};

/** Sales - Cash, Sales - Electronic Payment, Sales - Delivery ticked or not (the API's `sales_parts`). */
export type SalesParts = { cash: boolean; electronic: boolean; delivery: boolean };

const EVERY_PART: SalesParts = { cash: true, electronic: true, delivery: true };

/** The page's parts: what the API says; from an older API, every part a company had before
 * (a Non-cash company had no Delivery part). */
export function partsOf(page: Pick<SalesPage, "parts" | "groups">): SalesParts {
  return page.parts ?? { ...EVERY_PART, delivery: page.groups !== "non_cash" };
}

/**
 * A method's label exactly as Flask's template writes it: Python's `str.title()` of the name, so
 * "WeChat Pay" shows as "Wechat Pay" and "OpenRice" as "Openrice". Every run of letters gets a
 * capital first letter and lower-case rest; anything else is a word boundary.
 */
export function flaskLabel(name: string): string {
  return name
    .replace(/_sales/g, "")
    .replace(/_/g, " ")
    .replace(/[A-Za-z]+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

/** The methods each section lists, in order.
 * A Non-cash company has one section, `electronic`, holding every method - delivery ones included. */
export function sections<M extends Pick<SalesMethod, "type" | "value_name">>(
  methods: M[],
  groups: SalesGroups = "electronic_delivery",
  parts: SalesParts = partsOf({ groups }),
): {
  electronic: M[];
  delivery: M[];
} {
  const kept = methods;
  // A Non-cash company without a Delivery part keeps every method in its one section; one that
  // ticked Delivery (2026-11-17) gets its delivery methods in their own part.
  if (groups === "non_cash" && !parts.delivery) {
    return { electronic: parts.electronic ? kept : [], delivery: [] };
  }
  return {
    electronic: parts.electronic ? kept.filter((m) => m.type === "electronic") : [],
    delivery: parts.delivery ? kept.filter((m) => m.type === "delivery") : [],
  };
}

/** The three totals under the sections, from what the fields show. */
export function salesTotals(
  methods: SalesMethod[],
  values: Record<string, string>,
  cash: string,
  groups: SalesGroups = "electronic_delivery",
  parts: SalesParts = partsOf({ groups }),
): { electronic: number; delivery: number; cash: number } {
  const { electronic, delivery } = sections(methods, groups, parts);
  const sum = (list: SalesMethod[]) =>
    list.reduce((total, m) => total + parseMoney(values[m.value_name] ?? ""), 0);
  return {
    electronic: sum(electronic),
    delivery: sum(delivery),
    cash: parts.cash ? parseMoney(cash) : 0,
  };
}

/**
 * Whether a field holds something new - Flask's `hasUnsavedChanges`: a value that differs from the
 * one the page opened with, commas aside. Emptying a field does not count.
 */
export function changed(now: string, initial: string): boolean {
  const norm = (v: string) => {
    const s = v.trim().replace(/,/g, "");
    return s === "-" ? "" : s;
  };
  const current = norm(now);
  return current !== "" && current !== norm(initial);
}
