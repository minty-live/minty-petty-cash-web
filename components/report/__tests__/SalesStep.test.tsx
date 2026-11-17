// The Sales step's parts follow onboarding's sales accounts (owner, 2026-11-17; Figma 464:73 row 3):
// a part shows only while its account is ticked - the API's `parts` - and the save sends nothing for
// a hidden part. An answer without `parts` (an older API) shows all three, as before.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/apiClient", async (original) => ({
  ...(await original<typeof import("@/lib/apiClient")>()),
  pettyCashFetch: vi.fn(),
}));
vi.mock("@/lib/useAuth", () => ({
  useAuth: () => ({ entityId: "360812e1-9f3a-4c21-8e5b-1a2b3c4d5e6f", entityName: "DB Test Co" }),
}));

import { ToastProvider } from "@/components/flask/Toasts";
import { SalesStep } from "@/components/report/SalesStep";
import { pettyCashFetch } from "@/lib/apiClient";
import type { SalesPage } from "@/lib/sales";

const fetchMock = vi.mocked(pettyCashFetch);

const page = (over: Partial<SalesPage> = {}): SalesPage => ({
  transaction_date: "2026-11-16",
  currency_code: "HKD",
  draft: { current_section: "sales", completed_sections: ["opening"] } as SalesPage["draft"],
  methods: [
    { sale_id: "v", name: "Visa", value_name: "visa_sales", type: "electronic", amount: null },
    { sale_id: "k", name: "Keeta", value_name: "keeta_sales", type: "delivery", amount: null },
  ],
  cash_sales: null,
  groups: "electronic_delivery",
  ...over,
});

function renderWith(answer: SalesPage) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === "/reports/sales") return answer as never;
    return { next: "expenses", transaction_date: "2026-11-16" } as never;
  });
  return render(
    <ToastProvider>
      <SalesStep day="2026-11-16" />
    </ToastProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  router.push.mockReset();
});

describe("SalesStep -- the parts", () => {
  it("shows all three parts when the API says nothing about them", async () => {
    renderWith(page());
    expect(await screen.findByText("Electronic Payments")).toBeInTheDocument();
    expect(screen.getByText("Delivery Sales")).toBeInTheDocument();
    expect(screen.getByText("Cash Sales")).toBeInTheDocument();
  });

  it("leaves out Delivery Sales when Sales - Delivery is not ticked", async () => {
    renderWith(page({ parts: { cash: true, electronic: true, delivery: false } }));
    expect(await screen.findByText("Electronic Payments")).toBeInTheDocument();
    expect(screen.queryByText("Delivery Sales")).toBeNull();
    expect(screen.queryByText("Keeta")).toBeNull();
  });

  it("Cash only: one cash total and nothing else", async () => {
    renderWith(page({ parts: { cash: true, electronic: false, delivery: false } }));
    expect(await screen.findByText("Cash Sales")).toBeInTheDocument();
    expect(screen.queryByText("Electronic Payments")).toBeNull();
    expect(screen.queryByText("Delivery Sales")).toBeNull();
  });

  it("no Cash Sales part for a company banking all its sales; the save sends no cash", async () => {
    renderWith(page({ parts: { cash: false, electronic: true, delivery: true } }));
    expect(await screen.findByText("Electronic Payments")).toBeInTheDocument();
    expect(screen.queryByText("Cash Sales")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Save & Next/ }));
    const save = fetchMock.mock.calls.find(([, init]) => (init as { method?: string })?.method);
    expect(save?.[1]).toMatchObject({ json: { cash_sales: 0 } });
  });

  it("a retail shop that ticked Delivery shows Electronic Payments and Delivery Sales", async () => {
    renderWith(
      page({ groups: "non_cash", parts: { cash: true, electronic: true, delivery: true } }),
    );
    expect(await screen.findByText("Electronic Payments")).toBeInTheDocument();
    expect(screen.getByText("Delivery Sales")).toBeInTheDocument();
  });
});
