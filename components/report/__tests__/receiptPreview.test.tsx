// A line's receipts read for showing, and drawn by the shared preview (components/report/
// receiptPreview.ts; the viewer itself is @minty/shared/filePreview's since v0.37). iPhone HEIC (the user, 2026-11-24): stored as uploaded and drawn as it is
// where the browser can; elsewhere the API is asked for a JPEG made on the fly (`?as=jpeg`).

import { renderHook, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async (original) => ({
  ...(await original<typeof import("@/lib/apiClient")>()),
  pettyCashBlob: vi.fn(),
}));
// jsdom draws nothing: whether the browser draws HEIC is stood in for
vi.mock("@minty/shared/heic", async (original) => ({
  ...(await original<typeof import("@minty/shared/heic")>()),
  browserDrawsHeic: vi.fn(),
}));

import { receiptPreviewItem, useReceiptUrls } from "@/components/report/receiptPreview";
import { pettyCashBlob } from "@/lib/apiClient";
import type { ExpenseLine } from "@/lib/expenses";
import { browserDrawsHeic } from "@minty/shared/heic";

const blobMock = vi.mocked(pettyCashBlob);
const drawsMock = vi.mocked(browserDrawsHeic);

const line = (name: string, type: string) =>
  ({ id: "l1", receipts: [{ id: "r1", name, mime_type: type }] }) as unknown as ExpenseLine;

let made = 0;
beforeAll(() => {
  URL.createObjectURL = (blob: Blob | MediaSource) => `blob:${(blob as Blob).type}#${++made}`;
  URL.revokeObjectURL = () => undefined;
});
beforeEach(() => {
  made = 0;
  blobMock.mockReset();
  drawsMock.mockReset();
});

const PATH = "/expense-lines/l1/receipts/r1";

describe("useReceiptUrls", () => {
  it("reads a JPEG or PDF once, as it is", async () => {
    blobMock.mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));

    const { result } = renderHook(({ shown }) => useReceiptUrls(shown), {
      initialProps: { shown: line("slip.jpg", "image/jpeg") },
    });

    await waitFor(() => expect(result.current.r1?.url).toBe("blob:image/jpeg#1"));
    expect(blobMock.mock.calls.map((c) => c[0])).toEqual([PATH]);
    expect(drawsMock).not.toHaveBeenCalled();
  });

  it("shows a HEIC as it is where the browser draws it (Safari 17+)", async () => {
    blobMock.mockResolvedValue(new Blob(["x"], { type: "image/heic" }));
    drawsMock.mockResolvedValue(true);

    const { result } = renderHook(({ shown }) => useReceiptUrls(shown), {
      initialProps: { shown: line("IMG_1.HEIC", "image/heic") },
    });

    await waitFor(() => expect(result.current.r1?.url).toBe("blob:image/heic#1"));
    expect(blobMock.mock.calls.map((c) => c[0])).toEqual([PATH]);
  });

  it("asks for a JPEG made on the fly where the browser can't draw HEIC", async () => {
    blobMock.mockImplementation(async (path) =>
      path.endsWith("?as=jpeg")
        ? new Blob(["jpeg"], { type: "image/jpeg" })
        : new Blob(["heic"], { type: "image/heic" }),
    );
    drawsMock.mockResolvedValue(false);

    const { result } = renderHook(({ shown }) => useReceiptUrls(shown), {
      initialProps: { shown: line("IMG_1.HEIC", "image/heic") },
    });

    await waitFor(() => expect(result.current.r1?.url).toBe("blob:image/jpeg#2"));
    expect(blobMock.mock.calls.map((c) => c[0])).toEqual([PATH, `${PATH}?as=jpeg`]);
  });

  it("says the receipt failed when the JPEG can't be made either", async () => {
    blobMock.mockImplementation(async (path) => {
      if (path.endsWith("?as=jpeg")) throw new Error("422");
      return new Blob(["heic"], { type: "image/heic" });
    });
    drawsMock.mockResolvedValue(false);

    const { result } = renderHook(({ shown }) => useReceiptUrls(shown), {
      initialProps: { shown: line("IMG_1.HEIC", "image/heic") },
    });

    await waitFor(() => expect(result.current.r1).toEqual({ failed: true }));
  });
});

describe("receiptPreviewItem", () => {
  it("keeps the type the receipt was saved with", () => {
    expect(
      receiptPreviewItem({ id: "r1", name: "IMG_1.HEIC", mime_type: "image/heic" }, "blob:a"),
    ).toEqual({ url: "blob:a", name: "IMG_1.HEIC", mime: "image/heic" });
  });

  it("reads the name when the type says nothing (B2's octet-stream, or none)", () => {
    const pdf = { id: "r1", name: "slip.pdf", mime_type: "application/octet-stream" };
    const old = { id: "r2", name: "slip.PNG", mime_type: null };

    expect(receiptPreviewItem(pdf, "blob:a").mime).toBe("application/pdf");
    expect(receiptPreviewItem(old, "blob:b").mime).toBe("image/*");
  });
});
