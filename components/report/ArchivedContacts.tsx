"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useToast } from "@/components/flask/Toasts";
import { ApiError } from "@/lib/apiClient";
import {
  archivedSentence,
  linkXeroContact,
  loadXeroContacts,
  type ArchivedContact,
  type XeroContact,
} from "@/lib/publish";

const UNREACHABLE = "We couldn't reach Petty Cash. Check your connection, then try again.";
const NO_XERO_CONTACTS =
  "Xero has no active contact to map to. Restore the contact in Xero instead.";
const LIST_FAILED = "Your Xero contacts didn't load. Go back, then publish again to retry.";

const FIELD =
  "min-h-[44px] w-full min-w-0 rounded-flask-lg border border-flask-gray-300 bg-flask-white px-3 py-2 text-sm text-flask-gray-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-flask-focus disabled:bg-flask-gray-100";
const BACK =
  "min-h-[44px] flex-1 rounded-flask-xl border-2 border-flask-secondary-edge px-4 py-3 font-medium text-flask-secondary-ink transition-colors hover:bg-flask-teal-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-flask-focus disabled:opacity-70";
const MAP =
  "min-h-[44px] flex-1 rounded-flask-xl bg-flask-teal px-4 py-3 font-medium text-flask-white transition-colors hover:bg-flask-teal-hover active:bg-flask-teal-pressed focus:outline-none focus-visible:ring-2 focus-visible:ring-flask-focus disabled:cursor-not-allowed disabled:opacity-70";

/** Why "Map and publish" is greyed out, or null when it may go (CLAUDE.md's gated-button rule). */
function gateReason(
  contacts: ArchivedContact[],
  picks: Record<string, string>,
  options: XeroContact[] | null | "failed",
): string | null {
  if (options === null) return "Loading your Xero contacts…";
  if (options === "failed") return LIST_FAILED;
  if (options.length === 0) return NO_XERO_CONTACTS;
  const missing = contacts.filter((c) => !picks[c.id]);
  if (missing.length === 0) return null;
  return missing.length === 1
    ? `Choose the Xero contact for ${missing[0].name} to continue.`
    : "Choose a Xero contact for each contact above to continue.";
}

/**
 * "A contact is archived in Xero" (owner's decisions, C4, 2026-11-19): the publish was refused
 * (409) because Xero archived contacts the report uses without merging them, and nothing was
 * sent. Per contact the doc's sentence and a picker of the company's active Xero contacts (read
 * once, on open); "Map and publish" maps each (`POST /contacts/<id>/xero-link`), toasts each
 * answer and hands back to publish again. A refused mapping says its sentence here and keeps the
 * dialog open; one already mapped is not sent twice. Go back, Escape or the backdrop close it with
 * nothing changed. A form, so this app's own frame: a full-width sheet on a phone, a card from sm.
 */
export function ArchivedContactsDialog({
  contacts,
  onCancel,
  onMapped,
}: {
  contacts: ArchivedContact[];
  onCancel: () => void;
  /** Every contact is mapped: publish again. */
  onMapped: () => void;
}) {
  const toast = useToast();
  /** The company's Xero contacts: null while they load, "failed" when the read was refused. */
  const [options, setOptions] = useState<XeroContact[] | null | "failed">(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const problemRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    panel.current?.focus();
    let live = true;
    loadXeroContacts().then(
      (list) => {
        if (live) setOptions(list);
      },
      (err: unknown) => {
        if (!live) return;
        setOptions("failed");
        setProblem(err instanceof ApiError ? err.message : UNREACHABLE);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  const reason = gateReason(contacts, picks, options);
  const list = Array.isArray(options) ? options : [];

  async function mapAndPublish() {
    if (reason || busy) return;
    setBusy(true);
    setProblem(null);
    const mapped = new Set(done);
    for (const contact of contacts) {
      if (mapped.has(contact.id)) continue;
      try {
        toast(await linkXeroContact(contact.id, picks[contact.id]), "success");
        mapped.add(contact.id);
        setDone(new Set(mapped));
      } catch (err) {
        setBusy(false);
        // a 401 is already on its way back through the hand-off
        if (!(err instanceof ApiError && err.status === 401))
          setProblem(err instanceof ApiError ? err.message : UNREACHABLE);
        return;
      }
    }
    setBusy(false);
    onMapped();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-end justify-center bg-flask-scrim sm:items-center sm:p-4"
      data-leave-dialog=""
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="archivedContactsTitle"
        tabIndex={-1}
        className="max-h-[90dvh] w-full min-w-0 overflow-y-auto rounded-t-flask-2xl bg-flask-white shadow-flask-xl outline-none sm:max-w-lg sm:rounded-flask-2xl"
      >
        <form
          className="p-4 sm:p-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void mapAndPublish();
          }}
        >
          <h2 id="archivedContactsTitle" className="mb-4 text-xl font-bold text-flask-gray-900">
            {contacts.length === 1
              ? "A contact is archived in Xero"
              : "Some contacts are archived in Xero"}
          </h2>

          <div className="space-y-5">
            {contacts.map((c) => {
              const id = `archivedContact_${c.id}`;
              const linked = done.has(c.id);
              return (
                <div key={c.id}>
                  <p className="mb-2 text-sm text-flask-gray-700">{archivedSentence(c.name)}</p>
                  <label
                    htmlFor={id}
                    className="mb-1 block text-sm font-medium text-flask-gray-700"
                  >
                    Map {c.name} to
                  </label>
                  <select
                    id={id}
                    value={picks[c.id] ?? ""}
                    disabled={busy || linked || list.length === 0}
                    onChange={(e) => {
                      const value = e.target.value;
                      setPicks((p) => ({ ...p, [c.id]: value }));
                    }}
                    className={FIELD}
                  >
                    <option value="" disabled>
                      {options === null ? "Loading Xero contacts…" : "— Select a Xero contact —"}
                    </option>
                    {list.map((o) => (
                      <option key={o.xero_contact_id} value={o.xero_contact_id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  {linked ? <p className="mt-1 text-sm text-flask-gray-500">Mapped.</p> : null}
                </div>
              );
            })}
          </div>

          <p className="mt-5 text-sm text-flask-gray-500">
            Or restore it in Xero, then publish again.
          </p>

          {problem ? (
            <p
              ref={problemRef}
              role="alert"
              tabIndex={-1}
              className="mt-4 rounded-flask-lg bg-flask-danger-bg p-3 text-sm text-flask-danger-ink outline-none [overflow-wrap:anywhere]"
            >
              {problem}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
            <button type="button" onClick={onCancel} disabled={busy} className={BACK}>
              Go back
            </button>
            <button
              type="submit"
              disabled={reason !== null || busy}
              aria-describedby={reason ? "archivedContactsGate" : undefined}
              className={MAP}
            >
              {busy ? "Mapping…" : "Map and publish"}
            </button>
          </div>
          {reason ? (
            <p id="archivedContactsGate" className="mt-2 text-sm text-flask-gray-500 sm:text-right">
              {reason}
            </p>
          ) : null}
        </form>
      </div>
    </div>,
    document.body,
  );
}
