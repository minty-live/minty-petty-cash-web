"use client";

import { useEffect, useState } from "react";

import { pettyCashBlob } from "@/lib/apiClient";
import type { ExpenseLine, Receipt } from "@/lib/expenses";
import { nameToPreviewMime, type AttachmentPreviewItem } from "@/lib/filePreview";
import { browserDrawsHeic, isHeic } from "@minty/shared/heic";

/**
 * A saved receipt as `@minty/shared/filePreview` draws it, once its bytes are an object URL. B2
 * hands a PDF back as octet-stream (and an old row may have no type): the name says what it is.
 */
export function receiptPreviewItem(receipt: Receipt, url: string): AttachmentPreviewItem {
  const type = receipt.mime_type?.trim().toLowerCase() ?? "";
  return {
    url,
    name: receipt.name,
    mime: type && type !== "application/octet-stream" ? type : nameToPreviewMime(receipt.name),
  };
}

export type ReceiptUrls = Record<string, { url?: string; failed?: boolean }>;

/**
 * A line's receipts as object URLs, read with the bearer from
 * `GET /expense-lines/<id>/receipts/<receipt id>` while `line` is shown, and let go after. An
 * iPhone HEIC is shown as it is where the browser draws it (Safari 17+); elsewhere the API is
 * asked for `?as=jpeg`, a JPEG made on the fly and never stored (the user, 2026-11-24).
 */
export function useReceiptUrls(line: ExpenseLine | null): ReceiptUrls {
  const [urls, setUrls] = useState<ReceiptUrls>({});
  useEffect(() => {
    if (!line) return;
    let live = true;
    const made: string[] = [];
    for (const receipt of line.receipts) {
      const path = `/expense-lines/${encodeURIComponent(line.id)}/receipts/${encodeURIComponent(receipt.id)}`;
      pettyCashBlob(path)
        .then(async (blob) => {
          let url = URL.createObjectURL(blob);
          if (isHeic(blob.type, receipt.name) && !(await browserDrawsHeic(url))) {
            URL.revokeObjectURL(url);
            url = URL.createObjectURL(await pettyCashBlob(`${path}?as=jpeg`));
          }
          made.push(url);
          if (live) setUrls((all) => ({ ...all, [receipt.id]: { url } }));
          else URL.revokeObjectURL(url);
        })
        .catch(() => {
          if (live) setUrls((all) => ({ ...all, [receipt.id]: { failed: true } }));
        });
    }
    return () => {
      live = false;
      made.forEach((url) => URL.revokeObjectURL(url));
      setUrls({});
    };
  }, [line]);
  return urls;
}
