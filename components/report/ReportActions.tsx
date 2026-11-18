"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { useToast } from "@/components/flask/Toasts";
import { ReconnectModal } from "@/components/report/Publish";
import { QuestionDialog } from "@/components/ui/QuestionDialog";
import { Modal } from "@/components/report/ReportChrome";
import { ApiError, HOUSE_FALLBACK, pettyCashFetch } from "@/lib/apiClient";
import {
  DELETE_IN_XERO,
  DELETE_WARNING,
  EDIT_PUBLISHED,
  REMOVING_FROM_XERO,
  type DeleteXero,
} from "@/lib/report";
import { shareUrl } from "@/lib/share";
import { stepHref } from "@/lib/wizardPages";

const UNREACHABLE = "We couldn't reach Petty Cash. Check your connection, then reload the page.";
const COPY_FAILED = "Failed to copy link";

type Reopened = { report_id: string; transaction_date: string; status: "draft"; next: "opening" };

const CLOSE_ICON = (
  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

/** Flask's Export Options item: the round slate button with the share glyph, "Share" under it. */
export function ShareButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 sm:gap-3">
      <button
        type="button"
        onClick={onClick}
        aria-label="Share"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-flask-slate-100 transition duration-300 hover:-translate-y-0.5 hover:shadow-flask-lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flask-focus sm:h-16 sm:w-16"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          className="h-5 w-5 text-flask-olive sm:h-6 sm:w-6"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"
          />
        </svg>
      </button>
      <span className="text-sm text-flask-gray-700" aria-hidden="true">
        Share
      </span>
    </div>
  );
}

/**
 * Edit Report (a report's view) and Edit (report history), as Flask's `handleEditReport`: its
 * confirm first for a report that has been to Xero - here `EditPublishedModal`, in the page, never
 * the browser's own dialog (owner, 2026-11-16) - then "Converting report to draft...", `POST
 * /reports/<id>/reopen`, "Back to draft — opening it for you now.", then this app's Opening for
 * the day. A refusal says the API's sentence. `actingRef` is the page's one-action-at-a-time guard.
 * The page renders `ui` (the modal while it asks) with its other overlays.
 */
export function useEditReport(
  entityId: string,
  entityName: string,
  actingRef: RefObject<boolean>,
): { edit: (reportId: string, wasPublished: boolean) => void; ui: ReactNode } {
  const toast = useToast();
  const router = useRouter();
  /** The report a "Continue?" is being asked about, else null. */
  const [asking, setAsking] = useState<string | null>(null);

  function edit(reportId: string, wasPublished: boolean) {
    if (actingRef.current) return;
    if (wasPublished) setAsking(reportId);
    else void reopen(reportId);
  }

  async function reopen(reportId: string) {
    if (actingRef.current) return;
    actingRef.current = true;
    toast("Converting report to draft...", "info");
    try {
      const answer = await pettyCashFetch<Reopened>(
        `/reports/${encodeURIComponent(reportId)}/reopen`,
        { method: "POST" },
      );
      toast("Back to draft — opening it for you now.", "success");
      router.push(stepHref(entityId, entityName, "opening", answer.transaction_date));
    } catch (err) {
      actingRef.current = false;
      if (err instanceof ApiError && err.status === 401) return;
      toast(err instanceof ApiError ? err.message : UNREACHABLE, "error");
    }
  }

  const ui = asking ? (
    <EditPublishedModal
      onCancel={() => setAsking(null)}
      onContinue={() => {
        setAsking(null);
        void reopen(asking);
      }}
    />
  ) : null;

  return { edit, ui };
}

/**
 * The amber "it is in Xero" note the Delete and Edit modals open with; also the report view's while
 * Edit Details is open on a report that has been to Xero (owner, 2026-11-17).
 */
export function AmberNote({
  className,
  title,
  body,
}: {
  className: string;
  title: string;
  body: string;
}) {
  return (
    <div
      className={`${className} flex items-start rounded-[8px] border-l-4 border-l-flask-amber-edge bg-flask-amber-bg px-4 py-3`}
    >
      <svg
        className="mr-3 mt-0.5 flex-shrink-0"
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="10"
          cy="10"
          r="9"
          className="fill-flask-amber-bg stroke-flask-amber"
          strokeWidth="2"
        />
        <rect x="9" y="8" width="2" height="5" rx="1" className="fill-flask-amber" />
        <rect x="9" y="5" width="2" height="2" rx="1" className="fill-flask-amber" />
      </svg>
      <div className="min-w-0">
        <p className="mb-1 text-sm font-bold text-flask-amber-ink">{title}</p>
        <p className="text-sm leading-snug text-flask-amber-ink">{body}</p>
      </div>
    </div>
  );
}

/**
 * "Edit Report" for a report already in Xero: the amber "already published" note in the same frame
 * as Delete Report, then Cancel / Continue.
 */
function EditPublishedModal({
  onCancel,
  onContinue,
}: {
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <QuestionDialog
      title="Edit Report"
      image="dont"
      busy={false}
      confirmLabel="Continue"
      backLabel="Cancel"
      onConfirm={onContinue}
      onBack={onCancel}
    >
      <p className="font-semibold">{EDIT_PUBLISHED.title}</p>
      <p>{EDIT_PUBLISHED.body}</p>
    </QuestionDialog>
  );
}

/**
 * Flask's share: the modal opens at once saying "Generating link...", then `POST
 * /reports/<id>/share-link` fills in the link. A refusal closes it and says the API's sentence.
 * `link` is null while closed, `{url: null}` while the link is being made.
 *
 * The link is this app's own public page, `<origin>/share/<path>` (app/share, lib/share.ts), built
 * from the answer's `path`; its `url` is Flask's old page and is not used. An answer without a
 * usable path closes the modal with the house sentence rather than show a link that cannot work.
 */
export function useShareLink(reportId: string) {
  const toast = useToast();
  const [link, setLink] = useState<{ url: string | null } | null>(null);
  // the latest request: a link that arrives after the modal was closed is dropped
  const ticket = useRef(0);

  async function open() {
    const mine = ++ticket.current;
    setLink({ url: null });
    try {
      const answer = await pettyCashFetch<{ path?: unknown }>(
        `/reports/${encodeURIComponent(reportId)}/share-link`,
        { method: "POST" },
      );
      if (ticket.current !== mine) return;
      const url = shareUrl(window.location.origin, answer?.path);
      if (url) {
        setLink({ url });
      } else {
        setLink(null);
        toast(HOUSE_FALLBACK, "error");
      }
    } catch (err) {
      if (ticket.current !== mine || (err instanceof ApiError && err.status === 401)) return;
      setLink(null);
      toast(err instanceof ApiError ? err.message : UNREACHABLE, "error");
    }
  }

  function close() {
    ticket.current += 1;
    setLink(null);
  }

  return { link, open, close };
}

/**
 * Flask's "Share Report" (#shareLinkModal): the 30-day sentence, the link in a read-only field with
 * Copy beside it, "Link copied to clipboard!" for three seconds, and Close.
 */
export function ShareModal({ url, onClose }: { url: string | null; onClose: () => void }) {
  const toast = useToast();
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  function shown() {
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 3000);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      shown();
    } catch {
      // no Clipboard API here (or no permission): Flask's way, the field selected and copied
      field.current?.select();
      field.current?.setSelectionRange(0, 99999);
      if (document.execCommand("copy")) shown();
      else toast(COPY_FAILED, "error");
    }
  }

  return (
    <Modal
      titleId="shareReportTitle"
      onClose={onClose}
      wide
      className="rounded-flask-lg bg-flask-white p-6"
    >
      <div className="mb-6 flex items-center justify-between">
        <h2 id="shareReportTitle" className="text-xl font-bold text-flask-gray-900">
          Share Report
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-flask-gray-400 hover:text-flask-gray-600"
        >
          {CLOSE_ICON}
        </button>
      </div>

      <div className="mb-6">
        <p className="mb-4 text-sm text-flask-gray-600">
          Share this link to allow others to view this report. The link will expire in 30 days.
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={field}
            type="text"
            readOnly
            disabled={!url}
            value={url ?? ""}
            placeholder="Generating link..."
            aria-label="Share link"
            className="min-w-0 flex-1 rounded-flask-lg border border-flask-gray-300 bg-flask-gray-50 px-4 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!url}
            className="whitespace-nowrap rounded-flask-lg bg-flask-teal px-4 py-2 font-medium text-flask-white transition-colors hover:bg-flask-teal-hover active:bg-flask-teal-pressed"
          >
            Copy
          </button>
        </div>
        {copied ? (
          <p className="mt-2 text-sm text-flask-green-ink" role="status">
            Link copied to clipboard!
          </p>
        ) : null}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-flask-lg border-2 border-flask-gray-300 px-4 py-2 font-medium text-flask-gray-700 transition-colors hover:bg-flask-hover"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}

/** Xero refused to take the report's entries out: the API's sentence and what to sort out there. */
export type DeleteRefusal = { message: string; reasons: string[] };

/**
 * Flask's "Delete Report" (#deleteReportModal): the red warning, then Cancel / Delete. A report that
 * has been to Xero says first whether its entries come out of Xero with it (`xero`, owner
 * 2026-11-17). When Xero refused (`refusal`), the modal stays open with the API's sentence and the
 * list of what to sort out in Xero, and Delete reads "Try again".
 */
export function DeleteReportModal({
  xero,
  refusal = null,
  onCancel,
  onDelete,
}: {
  xero: DeleteXero;
  refusal?: DeleteRefusal | null;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <QuestionDialog
      title="Delete Report"
      image="dont"
      busy={false}
      confirmLabel={refusal ? "Try again" : "Delete"}
      confirmTone="red"
      backLabel="Cancel"
      onConfirm={onDelete}
      onBack={onCancel}
    >
      {xero ? (
        <div>
          <p className="font-semibold">{DELETE_IN_XERO.title}</p>
          <p>{DELETE_IN_XERO[xero]}</p>
        </div>
      ) : null}
      {refusal ? (
        <div role="alert">
          <p>{refusal.message}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 [overflow-wrap:anywhere]">
            {refusal.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p>{DELETE_WARNING}</p>
      )}
    </QuestionDialog>
  );
}

/** A report a Delete is asked for: whether it has been to Xero, and whether its entries can come out. */
export type DeleteTarget = { id: string; xero: DeleteXero };

/**
 * Delete, as the report's view and report history both do it: the modal, then
 * `DELETE /reports/<id>` under the page's overlay ("Removing it from Xero..." when its entries come
 * out of Xero). A refusal from Xero (`reasons`, owner 2026-11-17) keeps the modal open with the list
 * and Try again; one asking for Xero to be reconnected opens the reconnect dialog; any other says
 * the API's sentence. `onDeleted` takes over on success (the page's overlay, toast and way on).
 */
export function useDeleteReport({
  entityId,
  entityName,
  actingRef,
  setBusy,
  onDeleted,
}: {
  entityId: string;
  entityName: string;
  actingRef: RefObject<boolean>;
  setBusy: (text: string | null) => void;
  onDeleted: (target: DeleteTarget) => Promise<void> | void;
}): { ask: (target: DeleteTarget) => void; ui: ReactNode } {
  const toast = useToast();
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const [refusal, setRefusal] = useState<DeleteRefusal | null>(null);
  const [reconnect, setReconnect] = useState<string | null>(null);

  function close() {
    setTarget(null);
    setRefusal(null);
  }

  async function remove(asked: DeleteTarget) {
    if (actingRef.current) return;
    actingRef.current = true;
    setBusy(asked.xero === "removes" ? REMOVING_FROM_XERO : "Deleting report...");
    try {
      await pettyCashFetch(`/reports/${encodeURIComponent(asked.id)}`, { method: "DELETE" });
    } catch (err) {
      actingRef.current = false;
      setBusy(null);
      if (err instanceof ApiError && err.status === 401) return;
      const body =
        err instanceof ApiError
          ? (err.body as { reasons?: unknown; reconnect?: unknown } | null)
          : null;
      const reasons = Array.isArray(body?.reasons) ? body.reasons.map(String) : [];
      if (err instanceof ApiError && reasons.length > 0) {
        setRefusal({ message: err.message, reasons });
        return;
      }
      close();
      if (err instanceof ApiError && body?.reconnect === true) setReconnect(err.message);
      else toast(err instanceof ApiError ? err.message : UNREACHABLE, "error");
      return;
    }
    close();
    await onDeleted(asked);
  }

  const ui = (
    <>
      {target ? (
        <DeleteReportModal
          xero={target.xero}
          refusal={refusal}
          onCancel={close}
          onDelete={() => void remove(target)}
        />
      ) : null}
      {reconnect ? (
        <ReconnectModal
          message={reconnect}
          entityId={entityId}
          entityName={entityName}
          onClose={() => setReconnect(null)}
        />
      ) : null}
    </>
  );

  return {
    ask: (asked) => {
      setRefusal(null);
      setTarget(asked);
    },
    ui,
  };
}
