// A report's publish History (components/report/PublishHistory.tsx, owner's H1 2026-11-19): every
// publish attempt under the report, newest first - a card per attempt on a phone, a table from
// 768px; a failure's issues marked Fixed or To fix (never colour alone); read only when opened.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async (original) => ({
  ...(await original<typeof import("@/lib/apiClient")>()),
  pettyCashFetch: vi.fn(),
}));

import { PublishHistory } from "@/components/report/PublishHistory";
import { ApiError, pettyCashFetch } from "@/lib/apiClient";
import type { PublishHistory as Answer } from "@/lib/history";

const fetchMock = vi.mocked(pettyCashFetch);

const ANSWER: Answer = {
  history: [
    {
      at: "2026-11-19T10:30:00+08:00",
      user_name: "Olive Owner",
      action: "publish_failed",
      details: [
        { text: "Account 400 is archived in Xero.", resolved: false },
        { text: "Acme isn't a Xero contact.", resolved: true },
      ],
    },
    {
      at: "2026-11-18T09:05:00+08:00",
      user_name: "Sam Lee",
      action: "publish_failed",
      details: [{ text: "Xero connection has expired", resolved: null }],
    },
    { at: "2026-11-17T08:00:00+08:00", user_name: null, action: "published", details: [] },
  ],
};

const openSection = async () => {
  render(<PublishHistory reportId="r-1" />);
  const toggle = screen.getByRole("button", { name: "History" });
  await userEvent.click(toggle);
  return toggle;
};

beforeEach(() => {
  fetchMock.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("the History section", () => {
  it("starts closed and reads nothing until opened", async () => {
    fetchMock.mockResolvedValue(ANSWER);
    render(<PublishHistory reportId="r-1" />);

    expect(screen.getByRole("button", { name: "History" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "History" }));

    expect(fetchMock).toHaveBeenCalledWith("/reports/r-1/history");
    expect(await screen.findByRole("table", { name: "Publish attempts" })).toBeInTheDocument();
  });

  it("draws a card per attempt on a phone: when, who and the pill, then the issues", async () => {
    fetchMock.mockResolvedValue(ANSWER);
    await openSection();

    const list = await screen.findByRole("list", { name: "Publish attempts" });
    expect(list).toHaveClass("md:hidden");
    const cards = Array.from(list.children) as HTMLElement[];
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent("19 Nov 2026 10:30");
    expect(cards[0]).toHaveTextContent("Olive Owner");
    expect(within(cards[0]).getByText("Publish failed")).toHaveClass("text-status-danger-ink");
    expect(within(cards[2]).getByText("Published")).toHaveClass("text-status-success-ink");
    expect(cards[2]).toHaveTextContent("-"); // nobody named
  });

  it("draws a table row per attempt from 768px, newest first", async () => {
    fetchMock.mockResolvedValue(ANSWER);
    await openSection();

    const table = await screen.findByRole("table", { name: "Publish attempts" });
    expect(table).toHaveClass("hidden", "md:table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Date", "User", "Action", "Details"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual([
      "19 Nov 2026 10:30",
      "18 Nov 2026 09:05",
      "17 Nov 2026 08:00",
    ]);
    expect(within(rows[1]).getAllByRole("cell")[1]).toHaveTextContent("Sam Lee");
    expect(within(rows[2]).getAllByRole("cell")[2]).toHaveTextContent("Published");
  });

  it("marks a fixed issue Fixed with a tick, an open one To fix, an older one neither", async () => {
    fetchMock.mockResolvedValue(ANSWER);
    await openSection();

    const table = await screen.findByRole("table", { name: "Publish attempts" });
    const fixed = within(table).getByText("Acme isn't a Xero contact.").closest("li")!;
    expect(fixed).toHaveTextContent("Fixed");
    expect(fixed).toHaveTextContent("check_circle");
    expect(fixed).not.toHaveClass("line-through");
    const open = within(table).getByText("Account 400 is archived in Xero.").closest("li")!;
    expect(open).toHaveTextContent("To fix");
    expect(within(open).getByText("To fix")).toHaveClass("text-status-danger-ink");
    const older = within(table).getByText("Xero connection has expired").closest("li")!;
    expect(older).not.toHaveTextContent("Fixed");
    expect(older).not.toHaveTextContent("To fix");
  });

  it("says when nothing has been sent to Xero yet", async () => {
    fetchMock.mockResolvedValue({ history: [] });
    await openSection();

    expect(
      await screen.findByText(
        "This report hasn't been sent to Xero yet. Each publish will show here, with any issues.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a refusal's sentence and reads again on Try again", async () => {
    fetchMock.mockRejectedValueOnce(new ApiError(404, "Hmm, I couldn't find that report.", null));
    fetchMock.mockResolvedValueOnce(ANSWER);
    await openSection();

    expect(await screen.findByRole("alert")).toHaveTextContent("Hmm, I couldn't find that report.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("table", { name: "Publish attempts" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("opens at once and comes into view at #history (report history's ⓘ)", async () => {
    window.history.replaceState(null, "", "/r#history");
    fetchMock.mockResolvedValue(ANSWER);
    render(<PublishHistory reportId="r-1" />);

    expect(screen.getByRole("button", { name: "History" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(document.getElementById("history")).not.toBeNull();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(await screen.findByRole("table", { name: "Publish attempts" })).toBeInTheDocument();
  });
});
