// "Map it to another contact now" at publish (owner's decisions, C4, 2026-11-19): a publish
// refused (409) over contacts Xero archived without a merge opens a dialog to map each one to an
// active Xero contact, then publishes again. Minty never restores anything in the customer's Xero.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async (original) => ({
  ...(await original<typeof import("@/lib/apiClient")>()),
  pettyCashFetch: vi.fn(),
}));

import { ToastProvider } from "@/components/flask/Toasts";
import { usePublish } from "@/components/report/Publish";
import { ApiError, pettyCashFetch } from "@/lib/apiClient";

const fetchMock = vi.mocked(pettyCashFetch);

const ARCHIVED = {
  error:
    "Kee Wah is archived in Xero. Restore it in Xero, or map it to another contact now.\n" +
    "Star Ferry is archived in Xero. Restore it in Xero, or map it to another contact now.",
  archived_contacts: [
    { id: "c-1", name: "Kee Wah" },
    { id: "c-2", name: "Star Ferry" },
  ],
};
const XERO = {
  contacts: [
    { xero_contact_id: "x-a", name: "Alpha Ltd" },
    { xero_contact_id: "x-b", name: "Beta Ltd" },
  ],
};

function Harness() {
  const publish = usePublish({
    place: "submitted",
    entityId: "e-1",
    entityName: "DB Test Co",
    onChanged: () => undefined,
  });
  return (
    <>
      <button type="button" onClick={() => publish.ask({ reportId: "r-1", confirm: null })}>
        Publish
      </button>
      {publish.ui}
    </>
  );
}

/** Routes each call; `publishes` answers the POSTs to /publish in turn. */
function api({
  publishes,
  link = () => Promise.resolve({ message: "Linked.", contact_id: "c" }),
}: {
  publishes: (() => Promise<unknown>)[];
  link?: (path: string, body: unknown) => Promise<unknown>;
}) {
  let n = 0;
  fetchMock.mockImplementation(((path: string, init?: { method?: string; json?: unknown }) => {
    if (path === "/reports/r-1/publish") return publishes[Math.min(n++, publishes.length - 1)]();
    if (path === "/xero/contacts") return Promise.resolve(XERO);
    if (path.endsWith("/xero-link")) return link(path, init?.json);
    if (path.endsWith("/publishing-status")) return new Promise(() => undefined);
    throw new Error(`unexpected ${path}`);
  }) as never);
}

const refusedArchived = () => Promise.reject(new ApiError(409, ARCHIVED.error, ARCHIVED));
const accepted = () => Promise.resolve({ publishing_status: "publishing" });
const calls = () =>
  fetchMock.mock.calls.map(
    ([path, init]) => `${(init as { method?: string })?.method ?? "GET"} ${path}`,
  );

async function openDialog() {
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Publish" }));
  const dialog = await screen.findByRole("dialog", { name: "Some contacts are archived in Xero" });
  await within(dialog).findAllByRole("option", { name: "Alpha Ltd" });
  return dialog;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("a contact archived in Xero at publish", () => {
  it("opens the dialog with each contact's sentence and a picker of Xero contacts", async () => {
    api({ publishes: [refusedArchived] });
    const dialog = await openDialog();

    expect(
      within(dialog).getByText(
        "Kee Wah is archived in Xero. Restore it in Xero, or map it to another contact now.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Star Ferry is archived in Xero. Restore it in Xero, or map it to another contact now.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Map Kee Wah to")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Map Star Ferry to")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Or restore it in Xero, then publish again."),
    ).toBeInTheDocument();
    // the toast is not shown: the dialog replaces it
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // gated until every contact has a pick, with the reason beside it
    const map = within(dialog).getByRole("button", { name: "Map and publish" });
    expect(map).toBeDisabled();
    expect(
      within(dialog).getByText("Choose a Xero contact for each contact above to continue."),
    ).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText("Map Kee Wah to"), "x-a");
    expect(map).toBeDisabled();
    expect(
      within(dialog).getByText("Choose the Xero contact for Star Ferry to continue."),
    ).toBeInTheDocument();
  });

  it("Map and publish maps each contact, toasts each answer, then publishes again", async () => {
    const linked: [string, unknown][] = [];
    api({
      publishes: [refusedArchived, accepted],
      link: (path, body) => {
        linked.push([path, body]);
        return Promise.resolve({
          message: path.includes("c-1")
            ? "Kee Wah now uses Alpha Ltd in Xero."
            : "Star Ferry now uses Beta Ltd in Xero.",
          contact_id: "c",
        });
      },
    });
    const dialog = await openDialog();
    await userEvent.selectOptions(within(dialog).getByLabelText("Map Kee Wah to"), "x-a");
    await userEvent.selectOptions(within(dialog).getByLabelText("Map Star Ferry to"), "x-b");
    await userEvent.click(within(dialog).getByRole("button", { name: "Map and publish" }));

    expect(await screen.findByText("Kee Wah now uses Alpha Ltd in Xero.")).toBeInTheDocument();
    expect(screen.getByText("Star Ferry now uses Beta Ltd in Xero.")).toBeInTheDocument();
    expect(linked).toEqual([
      ["/contacts/c-1/xero-link", { xero_contact_id: "x-a" }],
      ["/contacts/c-2/xero-link", { xero_contact_id: "x-b" }],
    ]);
    await waitFor(() =>
      expect(calls().filter((c) => c === "POST /reports/r-1/publish")).toHaveLength(2),
    );
    expect(screen.queryByRole("dialog", { name: /archived in Xero/ })).not.toBeInTheDocument();
  });

  it("keeps the dialog open with a refused mapping's sentence, and does not map one twice", async () => {
    let attempt = 0;
    const linked: string[] = [];
    api({
      publishes: [refusedArchived, accepted],
      link: (path) => {
        linked.push(path);
        if (path.includes("c-2") && attempt++ === 0)
          return Promise.reject(
            new ApiError(409, "Beta Ltd is archived in Xero. Choose another contact.", {
              error: "Beta Ltd is archived in Xero. Choose another contact.",
            }),
          );
        return Promise.resolve({ message: "Mapped.", contact_id: "c" });
      },
    });
    const dialog = await openDialog();
    await userEvent.selectOptions(within(dialog).getByLabelText("Map Kee Wah to"), "x-a");
    await userEvent.selectOptions(within(dialog).getByLabelText("Map Star Ferry to"), "x-b");
    await userEvent.click(within(dialog).getByRole("button", { name: "Map and publish" }));

    expect(
      await within(dialog).findByText("Beta Ltd is archived in Xero. Choose another contact."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /archived in Xero/ })).toBeInTheDocument();
    expect(calls().filter((c) => c === "POST /reports/r-1/publish")).toHaveLength(1);

    await userEvent.selectOptions(within(dialog).getByLabelText("Map Star Ferry to"), "x-a");
    await userEvent.click(within(dialog).getByRole("button", { name: "Map and publish" }));
    await waitFor(() =>
      expect(calls().filter((c) => c === "POST /reports/r-1/publish")).toHaveLength(2),
    );
    expect(linked).toEqual([
      "/contacts/c-1/xero-link",
      "/contacts/c-2/xero-link",
      "/contacts/c-2/xero-link",
    ]);
  });

  it("Go back closes it and sends nothing", async () => {
    api({ publishes: [refusedArchived] });
    const dialog = await openDialog();
    await userEvent.selectOptions(within(dialog).getByLabelText("Map Kee Wah to"), "x-a");
    await userEvent.click(within(dialog).getByRole("button", { name: "Go back" }));

    expect(screen.queryByRole("dialog", { name: /archived in Xero/ })).not.toBeInTheDocument();
    expect(calls()).toEqual(["POST /reports/r-1/publish", "GET /xero/contacts"]);
  });

  it("Escape closes it too", async () => {
    api({ publishes: [refusedArchived] });
    await openDialog();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /archived in Xero/ })).not.toBeInTheDocument();
  });

  it("a 409 without archived contacts still toasts as before", async () => {
    api({
      publishes: [
        () =>
          Promise.reject(
            new ApiError(409, "Publishing already in progress. Please wait...", {
              error: "Publishing already in progress. Please wait...",
            }),
          ),
      ],
    });
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    const toast = await screen.findByText("Publishing already in progress. Please wait...");
    expect(toast.closest("[data-toast-type]")).toHaveAttribute("data-toast-type", "warning");
    expect(screen.queryByRole("dialog", { name: /archived in Xero/ })).not.toBeInTheDocument();
    expect(calls()).toEqual(["POST /reports/r-1/publish"]);
  });
});
