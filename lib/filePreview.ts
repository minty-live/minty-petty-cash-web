/**
 * The receipt preview, through `@minty/shared/filePreview` (v0.37; the user, 2026-11-24: as
 * Bills' attachments preview): every screen imports it from here, so this app's icon font
 * (Material Symbols Rounded) and its authenticated fetch are registered before anything draws.
 */
import { registerFilePreviewHost } from "@minty/shared/filePreview";

import { pettyCashBlob } from "@/lib/apiClient";

/** An API path's bytes as a `blob:` URL (untyped bytes typed `fallbackType`), or null on any failure. */
async function fetchBlob(apiPath: string, fallbackType: string): Promise<string | null> {
  try {
    const blob = await pettyCashBlob(apiPath);
    if (blob.size === 0) return null;
    const typed =
      blob.type && blob.type !== "application/octet-stream"
        ? blob
        : new Blob([await blob.arrayBuffer()], { type: fallbackType });
    return URL.createObjectURL(typed);
  } catch (err) {
    // the preview says it can't show the file; the console says why
    console.error("[filePreview] the file did not load", apiPath, err);
    return null;
  }
}

registerFilePreviewHost({ iconClass: "material-symbols-rounded", fetchBlob });

export * from "@minty/shared/filePreview";
