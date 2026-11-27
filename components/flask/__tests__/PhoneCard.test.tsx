// Petty Cash's page frame (the user, 2026-11-27): laid out as every app's page - the other apps'
// header across the window (‹ Back and the page's name; the company, the initials, the ≡), a band
// under it with the report's day, badge and stepper, and the content in the centred column. One
// scroll, the document's, so the scroll bar is at the window's edge.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => window.location.pathname }));

import { PhoneCard } from "@/components/flask/PhoneCard";

describe("PhoneCard", () => {
  it("scrolls the document: no scroller inside, the header and band held sticky", () => {
    const { container } = render(
      <PhoneCard company="Olive & Vine" backHref="/entities" stepper={<p>steps</p>}>
        <p>content</p>
      </PhoneCard>,
    );
    expect(container.querySelector(".overflow-y-auto, .overflow-auto, .h-screen")).toBeNull();
    const top = container.querySelector("[data-phone-card-top]");
    expect(top).toHaveClass("sticky", "top-0");
    expect(top).toHaveTextContent("steps");
    const content = container.querySelector("[data-phone-card-content]");
    expect(content).toHaveTextContent("content");
    expect(content).toHaveClass("flask-main-container");
    // a white page, the column in Flask's grey card (the user, 2026-11-27)
    expect(container.firstElementChild).toHaveClass("bg-flask-white");
    expect(container.querySelector("[data-phone-card]")).toHaveClass(
      "flask-main-container",
      "bg-flask-gray-50",
      "shadow-flask-xl",
    );
  });

  it("is the other apps' header: Back, the page's name, the company, across the window", () => {
    render(
      <PhoneCard company="Olive & Vine" title="Report History" backHref="/entities">
        <p>content</p>
      </PhoneCard>,
    );
    const bar = screen.getByRole("banner");
    expect(bar.closest(".flask-main-container")).toBeNull();
    expect(within(bar).getByRole("link", { name: "Back" })).toHaveAttribute("href", "/entities");
    expect(within(bar).getByRole("heading", { level: 1, name: "Report History" })).toBeVisible();
    expect(within(bar).getByText("Olive & Vine")).toHaveClass("truncate");
    expect(within(bar).getByRole("button", { name: "Open navigation menu" })).toBeVisible();
  });

  it("names the page Petty Cash by default; with no address of its own, Back goes to the company list", () => {
    render(
      <PhoneCard company="Olive & Vine">
        <p>content</p>
      </PhoneCard>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Petty Cash" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to your companies" })).toHaveTextContent("Back");
  });

  it("the main page (the dashboard) has no way back, as Payment Request's list", () => {
    render(
      <PhoneCard home company="Olive & Vine">
        <p>content</p>
      </PhoneCard>,
    );
    const bar = within(screen.getByRole("banner"));
    expect(bar.getByRole("heading", { level: 1, name: "Petty Cash" })).toBeVisible();
    expect(bar.queryByRole("link", { name: /Back/ })).toBeNull();
  });

  it("a report's day and badge sit in the band under the header, not in the bar", () => {
    const { container } = render(
      <PhoneCard company="Olive & Vine" datePill="13 OCT" badge={<span>Draft</span>}>
        <p>content</p>
      </PhoneCard>,
    );
    const band = container.querySelector("[data-phone-card-band]") as HTMLElement;
    expect(within(band).getByText("13 OCT")).toBeVisible();
    expect(within(band).getByText("Draft")).toBeVisible();
    expect(within(screen.getByRole("banner")).queryByText("13 OCT")).toBeNull();
  });

  it("a shared report: the name and the company only - no way back, no initials, no menu", () => {
    render(
      <PhoneCard publicView company="Olive & Vine" datePill="13 OCT">
        <p>content</p>
      </PhoneCard>,
    );
    const bar = within(screen.getByRole("banner"));
    expect(bar.getByText("Olive & Vine")).toBeVisible();
    expect(bar.queryByRole("link")).toBeNull();
    expect(bar.queryByRole("button")).toBeNull();
  });

  it("holds Flask's modals in a frame the screen's height, the column's width", () => {
    render(
      <PhoneCard company="Olive & Vine" overlays={<div role="dialog" aria-label="Confirm" />}>
        <p>content</p>
      </PhoneCard>,
    );
    const frame = screen.getByRole("dialog", { name: "Confirm" }).parentElement;
    expect(frame).toHaveClass("fixed", "inset-y-0", "flask-main-container");
  });
});
