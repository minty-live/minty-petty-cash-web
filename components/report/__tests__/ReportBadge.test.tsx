// The report status pill (components/report/ReportChrome.tsx, also drawn by report history):
// one tone per status, from @minty/shared's Part 13 status roles (owner, 2026-11-18) - Draft
// neutral, Submitted info, Published (to Xero) success, Publish failed danger.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({ default: () => null }));

import { BADGE_TONE, ReportBadge } from "@/components/report/ReportChrome";
import type { OpeningPage } from "@/lib/opening";

type Draft = OpeningPage["draft"];
const draft = (over: Partial<NonNullable<Draft>>): Draft =>
  ({
    id: "d",
    status: "submitted",
    current_section: null,
    completed_sections: [],
    xero_integrated: false,
    publishing_status: "unpublished",
    ...over,
  }) as Draft;

describe("the report status pill", () => {
  it.each([
    ["Draft", null, "bg-status-neutral-bg", "text-status-neutral-ink"],
    ["Draft", draft({ status: "draft" }), "bg-status-neutral-bg", "text-status-neutral-ink"],
    ["Submitted", draft({}), "bg-status-info-bg", "text-status-info-ink"],
    [
      "Published",
      draft({ xero_integrated: true, publishing_status: "completed" }),
      "bg-status-success-bg",
      "text-status-success-ink",
    ],
    [
      "Publish failed",
      draft({ publishing_status: "failed" }),
      "bg-status-danger-bg",
      "text-status-danger-ink",
    ],
  ] as const)("draws %s in its tone", (label, value, bg, ink) => {
    render(<ReportBadge draft={value} />);
    const pill = screen.getByText(label, { exact: true });
    expect(pill).toHaveClass(bg, ink, "rounded-full");
  });

  it("gives report history the same tones", () => {
    expect(BADGE_TONE).toEqual({
      Published: { bg: "bg-status-success-bg", ink: "text-status-success-ink" },
      "Publish failed": { bg: "bg-status-danger-bg", ink: "text-status-danger-ink" },
      Draft: { bg: "bg-status-neutral-bg", ink: "text-status-neutral-ink" },
      Submitted: { bg: "bg-status-info-bg", ink: "text-status-info-ink" },
    });
  });
});
