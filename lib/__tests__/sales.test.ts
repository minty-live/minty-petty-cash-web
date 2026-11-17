import { describe, expect, it } from "vitest";

import { changed, flaskLabel, partsOf, salesTotals, sections, type SalesMethod } from "@/lib/sales";

const method = (value_name: string, type: SalesMethod["type"], name = value_name): SalesMethod => ({
  sale_id: value_name,
  name,
  value_name,
  type,
  amount: null,
});

describe("method labels (Flask's str.title())", () => {
  it.each([
    ["Visa", "Visa"],
    ["WeChat Pay", "Wechat Pay"],
    ["UnionPay", "Unionpay"],
    ["OpenRice", "Openrice"],
    ["Food Panda", "Food Panda"],
    ["payme", "Payme"],
    ["7-eleven", "7-Eleven"],
    ["octopus_sales", "Octopus"],
  ])("%j shows as %j", (name, label) => {
    expect(flaskLabel(name)).toBe(label);
  });
});

describe("the sections and their totals", () => {
  const methods = [
    method("visa_sales", "electronic"),
    method("foodpanda_sales", "delivery"),
    method("deliveroo_sales", "delivery"),
    method("alipay_sales", "electronic"),
  ];

  it("leave Deliveroo out even when it is set up as an electronic method", () => {
    const { electronic } = sections([
      method("deliveroo_sales", "electronic"),
      method("visa_sales", "electronic"),
    ]);
    expect(electronic.map((m) => m.value_name)).toEqual(["visa_sales"]);
  });

  it("keep Settings order and leave Deliveroo out of delivery", () => {
    const { electronic, delivery } = sections(methods);
    expect(electronic.map((m) => m.value_name)).toEqual(["visa_sales", "alipay_sales"]);
    expect(delivery.map((m) => m.value_name)).toEqual(["foodpanda_sales"]);
  });

  it("add up what the fields show, commas and empties included", () => {
    expect(
      salesTotals(
        methods,
        {
          visa_sales: "1,200.50",
          alipay_sales: "",
          foodpanda_sales: "33.25",
          deliveroo_sales: "9",
        },
        "1,000.00",
      ),
    ).toEqual({ electronic: 1200.5, delivery: 33.25, cash: 1000 });
  });
});

describe("a Non-cash company (owner, 2026-11-11: retail, service, general)", () => {
  const methods = [
    method("visa_sales", "electronic"),
    method("foodpanda_sales", "delivery"),
    method("deliveroo_sales", "delivery"),
    method("fps_sales", "electronic"),
  ];

  it("lists every method in one Non-cash section, Settings order, Deliveroo still left out", () => {
    const { electronic, delivery } = sections(methods, "non_cash");
    expect(electronic.map((m) => m.value_name)).toEqual([
      "visa_sales",
      "foodpanda_sales",
      "fps_sales",
    ]);
    expect(delivery).toEqual([]);
  });

  it("adds them up as one Non-cash total", () => {
    expect(
      salesTotals(
        methods,
        { visa_sales: "100", foodpanda_sales: "20", fps_sales: "3" },
        "5",
        "non_cash",
      ),
    ).toEqual({ electronic: 123, delivery: 0, cash: 5 });
  });

  it("Electronic and Delivery stay apart for Restaurant & Food and an older company", () => {
    expect(sections(methods, "electronic_delivery").delivery.map((m) => m.value_name)).toEqual([
      "foodpanda_sales",
    ]);
    expect(sections(methods).delivery).toHaveLength(1);
  });
});

describe("unsaved changes (Flask's hasUnsavedChanges)", () => {
  it.each([
    ["5", "", true],
    ["30", "30.00", true],
    ["1,200.00", "1200.00", false],
    ["", "30.00", false], // emptying a field is not a change
    ["-", "", false],
  ])("%j against %j is %s", (now, initial, expected) => {
    expect(changed(now, initial)).toBe(expected);
  });
});

// The parts follow onboarding's sales accounts (owner, 2026-11-17; Figma 464:73 row 3).
describe("the parts a company takes", () => {
  const methods = [
    method("visa_sales", "electronic"),
    method("foodpanda_sales", "delivery"),
    method("fps_sales", "electronic"),
  ];

  it("shows every part when the API says nothing (an older API)", () => {
    expect(partsOf({})).toEqual({ cash: true, electronic: true, delivery: true });
  });

  it("keeps what the API says", () => {
    expect(partsOf({ parts: { cash: false, electronic: true, delivery: false } })).toEqual({
      cash: false,
      electronic: true,
      delivery: false,
    });
  });

  it("a Non-cash company that ticked Delivery gets its delivery methods in their own part", () => {
    const { electronic, delivery } = sections(methods, "non_cash", {
      cash: true,
      electronic: true,
      delivery: true,
    });
    expect(electronic.map((m) => m.value_name)).toEqual(["visa_sales", "fps_sales"]);
    expect(delivery.map((m) => m.value_name)).toEqual(["foodpanda_sales"]);
  });

  it("an unticked part lists nothing and adds nothing", () => {
    const parts = { cash: false, electronic: true, delivery: false };
    expect(sections(methods, "electronic_delivery", parts).delivery).toEqual([]);
    expect(
      salesTotals(
        methods,
        { visa_sales: "10", foodpanda_sales: "99", fps_sales: "1" },
        "7",
        "electronic_delivery",
        parts,
      ),
    ).toEqual({ electronic: 11, delivery: 0, cash: 0 });
  });
});
