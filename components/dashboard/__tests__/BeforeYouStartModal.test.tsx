// "Before You Start" (components/dashboard/Modals.tsx): the note under a changed or missing deposit.
//
// 2026-11-18: it said the deposit "will be reversed in Xero" to every company - one keeping its
// books in Minty has no Xero, and the API touches Xero only when the earlier report was published.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BeforeYouStartModal } from "@/components/dashboard/Modals";

const show = () =>
  render(
    <BeforeYouStartModal
      onClose={vi.fn()}
      day="2026-10-13"
      amount={300}
      bankName="HSBC Current"
      bankNumber="***-123"
      submitter="Olive"
      currencyCode="HKD"
      blockedBy={[]}
      mayCorrect
      settingsHref="/settings"
      onProceed={vi.fn()}
    />,
  );

describe("a changed or missing deposit", () => {
  it.each(["No, there was a change in the details", "No, there was no deposit"])(
    "%s: says the deposit is reversed, without naming Xero",
    (choice) => {
      show();
      fireEvent.click(screen.getByLabelText(choice));

      expect(
        screen.getByText(
          "By proceeding, you confirm that the stated deposit amount will be reversed.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Xero/)).not.toBeInTheDocument();
    },
  );
});
