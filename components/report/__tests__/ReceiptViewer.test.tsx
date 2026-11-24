// A receipt shown full screen and a line's receipts read for showing (components/report/
// ReceiptViewer.tsx). iPhone HEIC (the user, 2026-11-24): stored as uploaded and drawn as it is
// where the browser can; elsewhere the API is asked for a JPEG made on the fly (`?as=jpeg`).

import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
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

import { ReceiptViewer, useReceiptUrls } from "@/components/report/ReceiptViewer";
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

describe("ReceiptViewer", () => {
  it("says a picked HEIC can be seen once saved, where the browser can't draw it", () => {
    render(
      <ReceiptViewer
        receipt={{ url: "blob:picked", kind: "image", name: "IMG_1.HEIC" }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "IMG_1.HEIC" }));

    expect(screen.getByText("This photo can be viewed once it's saved.")).toBeTruthy();
  });

  it("keeps its own sentence for any other image that won't draw", () => {
    render(
      <ReceiptViewer
        receipt={{ url: "blob:picked", kind: "image", name: "slip.png" }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "slip.png" }));

    expect(screen.getByText("This image can't be previewed here.")).toBeTruthy();
  });
});
