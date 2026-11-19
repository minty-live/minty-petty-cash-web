"use client";

import { useEffect, useId, useRef, useState } from "react";

import { BADGE_TONE } from "@/components/report/ReportChrome";
import { ApiError, pettyCashFetch } from "@/lib/apiClient";
import {
  attemptLabel,
  HISTORY_ANCHOR,
  hkStamp,
  type PublishAttempt,
  type PublishHistory as PublishHistoryAnswer,
} from "@/lib/history";

const UNREACHABLE = "We couldn't reach Petty Cash. Check your connection, then try again.";
const EMPTY =
  "This report hasn't been sent to Xero yet. Each publish will show here, with any issues.";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; history: PublishAttempt[] }
  | { kind: "failed"; message: string };

const PILL = "inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium";
/** Material Symbols' own sheet sets every glyph to 24px, unlayered: a size here needs the style. */
const GLYPH = { fontSize: "1.125rem", lineHeight: 1 } as const;

function Pill({ attempt }: { attempt: PublishAttempt }) {
  const label = attemptLabel(attempt);
  const tone = BADGE_TONE[label];
  return <span className={`${PILL} ${tone.bg} ${tone.ink}`}>{label}</span>;
}

/**
 * A failure's issues, one a line: fixed since (the re-check of the newest failed attempt) with a
 * tick and "Fixed", still open with the danger mark and "To fix", an older attempt's (not checked
 * again) as they were. Never colour alone: each mark carries its word.
 */
function Details({ attempt }: { attempt: PublishAttempt }) {
  if (attempt.details.length === 0) return <span className="text-flask-gray-500">-</span>;
  return (
    <ul className="space-y-1.5">
      {attempt.details.map((issue, i) => (
        <li
          key={i}
          className="flex min-w-0 items-start gap-1.5"
          data-resolved={String(issue.resolved)}
        >
          {issue.resolved === true ? (
            <span
              className="material-symbols-rounded text-status-success-ink"
              style={GLYPH}
              aria-hidden="true"
            >
              check_circle
            </span>
          ) : issue.resolved === false ? (
            <span
              className="material-symbols-rounded text-status-danger-ink"
              style={GLYPH}
              aria-hidden="true"
            >
              error
            </span>
          ) : (
            <span
              className="material-symbols-rounded text-flask-gray-400"
              style={GLYPH}
              aria-hidden="true"
            >
              remove
            </span>
          )}
          <span className="min-w-0 break-words">
            {issue.text}
            {issue.resolved === true ? (
              <span className="ml-1.5 font-semibold text-status-success-ink">Fixed</span>
            ) : issue.resolved === false ? (
              <span className="ml-1.5 font-semibold text-status-danger-ink">To fix</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A report's publish History (owner's H1, 2026-11-19), modelled on Xero's History & Notes: under
 * the report on its view, a collapsible section with one entry per publish attempt, newest first -
 * Date (Hong Kong time), User, Action (Published / Publish failed) and Details (a failure's issues).
 * No notes for now. A card per attempt on a phone; from 768px a table.
 *
 * It reads `GET /reports/<id>/history` (petty-cash-api) only when opened, since the newest failure's
 * issues are checked against Xero. Report history's ⓘ beside "Publish failed" links here
 * (`#history`, `reportHistoryHref`): the section then opens and comes into view.
 */
export function PublishHistory({ reportId }: { reportId: string }) {
  // drawn only in the browser, after the report is read: the address is there to look at
  const [open, setOpen] = useState(
    () => typeof window !== "undefined" && window.location.hash === `#${HISTORY_ANCHOR}`,
  );
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const section = useRef<HTMLElement>(null);
  const panelId = useId();
  const needed = open && load.kind === "loading";

  useEffect(() => {
    if (window.location.hash === `#${HISTORY_ANCHOR}`)
      section.current?.scrollIntoView({ block: "start" });
  }, []);

  useEffect(() => {
    if (!needed) return;
    let live = true;
    pettyCashFetch<PublishHistoryAnswer>(`/reports/${encodeURIComponent(reportId)}/history`).then(
      (answer) => {
        if (live) setLoad({ kind: "ready", history: answer.history });
      },
      (err: unknown) => {
        // a 401 has already gone back through the hand-off
        if (!live || (err instanceof ApiError && err.status === 401)) return;
        setLoad({ kind: "failed", message: err instanceof ApiError ? err.message : UNREACHABLE });
      },
    );
    return () => {
      live = false;
    };
  }, [needed, reportId]);

  return (
    <section
      ref={section}
      id={HISTORY_ANCHOR}
      aria-labelledby={`${panelId}-title`}
      className="mt-6 scroll-mt-4 rounded-flask-2xl bg-flask-white"
    >
      <h2 id={`${panelId}-title`} className="text-base font-semibold text-flask-header">
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-flask-2xl px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flask-focus"
        >
          <span>History</span>
          <span
            className={`material-symbols-rounded text-flask-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            expand_more
          </span>
        </button>
      </h2>
      <div id={panelId} hidden={!open} className="px-4 pb-4 text-sm text-flask-gray-700">
        {!open ? null : load.kind === "loading" ? (
          <p className="text-flask-gray-500" role="status">
            Loading the history…
          </p>
        ) : load.kind === "failed" ? (
          <div className="flex flex-wrap items-center gap-3" role="alert">
            <p className="min-w-0">{load.message}</p>
            <button
              type="button"
              onClick={() => setLoad({ kind: "loading" })}
              className="min-h-11 rounded-flask-xl border border-flask-gray-300 px-4 py-2 font-medium text-flask-gray-700 transition-colors hover:bg-flask-hover"
            >
              Try again
            </button>
          </div>
        ) : load.history.length === 0 ? (
          <p className="text-flask-gray-500">{EMPTY}</p>
        ) : (
          <>
            {/* A phone: a card per attempt - when, who and the pill, then the issues. */}
            <ul className="space-y-3 md:hidden" aria-label="Publish attempts">
              {load.history.map((attempt, i) => (
                <li key={i} className="rounded-flask-xl border border-flask-gray-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-flask-gray-900">
                        {hkStamp(attempt.at) || "-"}
                      </p>
                      <p className="break-words text-flask-gray-600">{attempt.user_name ?? "-"}</p>
                    </div>
                    <Pill attempt={attempt} />
                  </div>
                  {attempt.details.length > 0 ? (
                    <div className="mt-2">
                      <Details attempt={attempt} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {/* From 768px: Xero's table - Date, User, Action, Details. */}
            <table className="hidden w-full table-fixed border-collapse text-left md:table">
              <caption className="sr-only">Publish attempts</caption>
              <thead>
                <tr className="border-b border-flask-gray-200 text-xs font-semibold text-flask-gray-600">
                  <th scope="col" className="w-36 py-2 pr-3">
                    Date
                  </th>
                  <th scope="col" className="w-32 py-2 pr-3">
                    User
                  </th>
                  <th scope="col" className="w-32 py-2 pr-3">
                    Action
                  </th>
                  <th scope="col" className="py-2">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {load.history.map((attempt, i) => (
                  <tr key={i} className="border-b border-flask-gray-100 align-top last:border-b-0">
                    <td className="py-3 pr-3">{hkStamp(attempt.at) || "-"}</td>
                    <td className="break-words py-3 pr-3">{attempt.user_name ?? "-"}</td>
                    <td className="py-3 pr-3">
                      <Pill attempt={attempt} />
                    </td>
                    <td className="py-3">
                      <Details attempt={attempt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  );
}
