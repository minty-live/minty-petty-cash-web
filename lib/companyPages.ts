/**
 * One company's pages in this app: `/entity/<shortid>/<name>/petty-cash/...` - the address form
 * every Minty app shares (`@minty/shared/companyRef`; Flask's `blueprints/shared/entity_ref.py`).
 * The first 8 hex characters name the company; the name after them is only for reading.
 */

import { companyRef } from "@minty/shared/companyRef";

import { WIZARD_STEP_PATH, type WizardStep } from "@/lib/wizardPages";

const COMPANY_PATH = /^\/entity\/([0-9a-fA-F]{8})\/([^/?#]+)(?:\/|$|\?|#)/;

/**
 * `<shortid>/<name>` from a path inside a company, or "" when the path names none. The name comes
 * back decoded - a path is percent-encoded, and the hand-off's query string encodes it again.
 */
export function companyRefFromPath(path: string): string {
  const m = COMPANY_PATH.exec(path);
  if (!m) return "";
  let name = m[2];
  try {
    name = decodeURIComponent(name);
  } catch {
    // a malformed escape: keep it as written - only the short id decides the company
  }
  return `${m[1].toLowerCase()}/${name}`;
}

/** The company's Petty Cash home (`/entity/<shortid>/<name>/petty-cash`) from its id and name. */
export function pettyCashHome(entityId: string, entityName: string): string {
  return `/entity/${companyRef(entityId, entityName)}/petty-cash`;
}

/** The steps a submitted report shows read-only, by their address segment (the wizard's, Flask's). */
export const REPORT_STEP_VIEWS = {
  opening: "opening",
  sale: "sales",
  expense: "expenses",
  deposit: "deposit",
  "cash-count": "cash_count",
} as const satisfies Record<string, Exclude<WizardStep, "ending">>;

export type ReportStepView = keyof typeof REPORT_STEP_VIEWS;

/**
 * What Back and Close step over on a submitted report's pages (`@minty/shared/backLink`'s `skip`):
 * its read-only steps, so moving between them never makes the way out longer - Back leaves the
 * report for where it was opened from (the summary, then the report list or the dashboard).
 */
export const REPORT_STEP_VIEW_SKIP = [
  /\/petty-cash\/reports\/[^/]+\/(opening|sale|expense|deposit|cash-count)$/,
];

/** Whether an address segment is one of {@link REPORT_STEP_VIEWS}. */
export function isReportStepView(segment: string): segment is ReportStepView {
  return Object.hasOwn(REPORT_STEP_VIEWS, segment);
}

/**
 * A report's own pages, at Flask's addresses for them: its Daily Report (`summary`), the page
 * after the submit (`submitted`) and each step read-only (`opening`, `sale`, `expense`, `deposit`,
 * `cash-count`) - `/entity/<shortid>/<name>/petty-cash/reports/<report id>/<page>`.
 */
export function reportHref(
  entityId: string,
  entityName: string,
  reportId: string,
  page: "summary" | "submitted" | ReportStepView,
): string {
  return `${pettyCashHome(entityId, entityName)}/reports/${encodeURIComponent(reportId)}/${page}`;
}

/**
 * A submitted report's view opened in Edit Details (report history's menu, owner 2026-11-17): the
 * summary with `?edit=details`, which the view reads once and then drops from the address.
 */
export function reportEditDetailsHref(
  entityId: string,
  entityName: string,
  reportId: string,
): string {
  return `${reportHref(entityId, entityName, reportId, "summary")}?edit=details`;
}

/** Where a submitted report's stepper leads: each step's read-only view, Ending to the summary. */
export function reportStepHref(
  entityId: string,
  entityName: string,
  reportId: string,
  step: WizardStep,
  { editDetails = false }: { editDetails?: boolean } = {},
): string {
  const href = reportHref(
    entityId,
    entityName,
    reportId,
    step === "ending" ? "summary" : WIZARD_STEP_PATH[step],
  );
  // while Edit Details is open, the next page opens in it too (owner, 2026-11-17)
  return editDetails ? `${href}?edit=details` : href;
}
