// The Expenses step's rules (../expenses.ts), as Flask's report/expense.html has them.

import { describe, expect, it } from "vitest";

import {
  detailRows,
  lineEdits,
  missingFields,
  newContactProblem,
  RECEIPT_ACCEPT,
  receiptKind,
  receiptProblem,
  searchAccounts,
  searchSuppliers,
  uploadName,
  type AddForm,
  type ExpenseLine,
} from "@/lib/expenses";

const S = (name: string) => ({ id: name.toLowerCase(), name });
const SUPPLIERS = [S("Wellcome"), S("ParknShop"), S("apple Daily"), S("Park Lane Florist")];

describe("searchSuppliers", () => {
  it("lists every supplier A to Z when nothing is typed, offering nothing new", () => {
    expect(searchSuppliers(SUPPLIERS, "  ")).toEqual({
      matches: [S("apple Daily"), S("Park Lane Florist"), S("ParknShop"), S("Wellcome")],
      offerNew: null,
    });
  });

  it("matches any part of the name in any case, and offers the text when nothing is exactly it", () => {
    expect(searchSuppliers(SUPPLIERS, " PARK")).toEqual({
      matches: [S("Park Lane Florist"), S("ParknShop")],
      offerNew: "PARK",
    });
  });

  it("offers nothing new on an exact name, whatever its case", () => {
    expect(searchSuppliers(SUPPLIERS, "parknshop")).toEqual({
      matches: [S("ParknShop")],
      offerNew: null,
    });
  });

  it("offers the text when nothing matches (Flask's 'No Xero contact found')", () => {
    expect(searchSuppliers(SUPPLIERS, "Kee Wah")).toEqual({ matches: [], offerNew: "Kee Wah" });
  });

  it("leaves the list it was given alone", () => {
    const list = [S("b"), S("a")];
    searchSuppliers(list, "");
    expect(list.map((s) => s.name)).toEqual(["b", "a"]);
  });
});

describe("searchAccounts", () => {
  const ACCOUNTS = [
    { id: "1", code: "429", name: "General Expenses" },
    { id: "2", code: "400", name: "Advertising" },
    { id: "3", code: "461", name: "Printing & Stationery" },
  ];
  it("keeps the API's order and matches by name or code (owner, 2026-10-27)", () => {
    expect(searchAccounts(ACCOUNTS, "")).toEqual(ACCOUNTS);
    expect(searchAccounts(ACCOUNTS, "IN").map((a) => a.id)).toEqual(["2", "3"]);
    expect(searchAccounts(ACCOUNTS, "429").map((a) => a.id)).toEqual(["1"]);
    expect(searchAccounts(ACCOUNTS, " 46").map((a) => a.id)).toEqual(["3"]);
  });

  it("copes with an account that has no code", () => {
    const noCode = [{ id: "9", code: "", name: "Suspense" }];
    expect(searchAccounts(noCode, "sus").map((a) => a.id)).toEqual(["9"]);
    expect(searchAccounts(noCode, "4")).toEqual([]);
  });
});

describe("receiptProblem", () => {
  const file = (name: string, type: string, size = 100) => ({ name, type, size });
  it("takes one PDF, JPEG or PNG of up to 10MB", () => {
    expect(receiptProblem([file("a.pdf", "application/pdf")], "picked")).toBeNull();
    expect(receiptProblem([file("a.jpg", "image/jpeg", 10 * 1024 * 1024)], "dropped")).toBeNull();
  });
  it("takes an iPhone HEIC, by its type or, when the type says nothing, its name (2026-11-24)", () => {
    expect(receiptProblem([file("IMG_1.HEIC", "image/heic")], "picked")).toBeNull();
    expect(receiptProblem([file("IMG_1.heif", "image/heif")], "dropped")).toBeNull();
    expect(receiptProblem([file("IMG_1.HEIC", "")], "picked")).toBeNull();
    expect(receiptProblem([file("IMG_1.HEIC", "application/octet-stream")], "picked")).toBeNull();
  });
  it("judges a file with no type by its name (Windows and some Android pickers give none)", () => {
    expect(receiptProblem([file("slip.jpg", "")], "picked")).toBeNull();
    expect(receiptProblem([file("slip.PDF", "")], "picked")).toBeNull();
    expect(receiptProblem([file("slip.gif", "")], "picked")).toBe(
      "I can take PDF, JPEG, PNG, or HEIC files.",
    );
  });
  it("refuses in Flask's words, naming a dropped file", () => {
    expect(receiptProblem([file("a.gif", "image/gif")], "picked")).toBe(
      "I can take PDF, JPEG, PNG, or HEIC files.",
    );
    expect(receiptProblem([file("a.gif", "image/gif")], "dropped")).toBe(
      "I can take PDF, JPEG, PNG, or HEIC files: a.gif",
    );
    expect(receiptProblem([file("big.png", "image/png", 10 * 1024 * 1024 + 1)], "picked")).toBe(
      "Files need to be under 10MB.",
    );
    expect(receiptProblem([file("big.png", "image/png", 10 * 1024 * 1024 + 1)], "dropped")).toBe(
      "Files need to be under 10MB: big.png",
    );
    expect(
      receiptProblem([file("a.png", "image/png"), file("b.png", "image/png")], "dropped"),
    ).toBe("Only one file is allowed per expense.");
  });
});

describe("uploadName and receiptKind", () => {
  it("cuts a long name to 27 characters", () => {
    expect(uploadName("receipt.pdf")).toBe("receipt.pdf");
    expect(uploadName("a".repeat(30))).toBe("a".repeat(30));
    expect(uploadName(`${"a".repeat(28)}.pdf`)).toBe(`${"a".repeat(27)}...`);
  });
  it("draws by type, else by name", () => {
    expect(receiptKind("image/png")).toBe("image");
    expect(receiptKind("application/pdf")).toBe("pdf");
    expect(receiptKind(null, "scan.PDF")).toBe("pdf");
    expect(receiptKind("application/octet-stream", "photo.jpeg")).toBe("image");
    expect(receiptKind("text/plain", "notes.txt")).toBe("other");
  });
  it("draws an iPhone HEIC as an image", () => {
    expect(receiptKind("image/heic")).toBe("image");
    expect(receiptKind(null, "IMG_1.HEIC")).toBe("image");
  });
});

describe("RECEIPT_ACCEPT", () => {
  it("lists JPEG first (iOS converts a HEIC to the first type), then PNG, PDF and HEIC", () => {
    expect(RECEIPT_ACCEPT).toBe(
      "image/jpeg,image/png,application/pdf,image/heic,image/heif,.jpg,.jpeg,.png,.pdf,.heic,.heif",
    );
  });
});

describe("missingFields", () => {
  const supplier = S("Wellcome");
  const account = { id: "1", code: "429", name: "General Expenses" };
  const full: AddForm = {
    amount: "12.50",
    supplierText: "Wellcome",
    supplier,
    accountText: "General Expenses",
    account,
    file: new File(["x"], "r.png", { type: "image/png" }),
  };
  it("passes a complete form", () => {
    expect(missingFields(full)).toEqual([]);
  });
  it("counts the receipt reader's new supplier while the box holds its name (2026-11-23)", () => {
    const read = { ...full, supplier: null, supplierText: "Kwok Transport" };
    expect(missingFields({ ...read, newSupplier: { name: "Kwok Transport" } })).toEqual([]);
    expect(missingFields({ ...read, newSupplier: { name: "Kwok" } })).toEqual(["supplier"]);
    expect(missingFields(read)).toEqual(["supplier"]);
  });
  it("refuses a zero amount, a supplier or account not chosen from the list, and no receipt", () => {
    expect(
      missingFields({
        amount: "0.00",
        supplierText: "",
        supplier: null,
        accountText: "",
        account: null,
        file: null,
      }),
    ).toEqual(["amount", "supplier", "account", "file"]);
  });
  it("refuses a choice whose text was changed after it was made", () => {
    expect(missingFields({ ...full, supplierText: "Wellcom", accountText: "General" })).toEqual([
      "supplier",
      "account",
    ]);
    expect(missingFields({ ...full, supplierText: "  Wellcome " })).toEqual([]);
  });
  it("refuses an empty file", () => {
    expect(missingFields({ ...full, file: new File([], "r.png", { type: "image/png" }) })).toEqual([
      "file",
    ]);
  });
});

describe("detailRows", () => {
  const line: ExpenseLine = {
    id: "l",
    item: "General Expenses",
    amount: 5,
    description: "",
    supplier: null,
    account: null,
    receipts: [],
  };
  it("writes N/A and - for what a line lacks", () => {
    expect(detailRows(line)).toEqual({
      contact: "N/A",
      description: "-",
      account: "N/A General Expenses",
    });
  });
  it("writes the account as its code then the line's item", () => {
    expect(
      detailRows({
        ...line,
        description: "Milk",
        supplier: S("Wellcome"),
        account: { id: "1", code: "429", name: "General Expenses" },
      }),
    ).toEqual({ contact: "Wellcome", description: "Milk", account: "429 General Expenses" });
  });
});

describe("newContactProblem", () => {
  it("says nothing up to 150 characters, then the API's sentence", () => {
    expect(newContactProblem("")).toBeNull();
    expect(newContactProblem("x".repeat(150))).toBeNull();
    expect(newContactProblem(` ${"x".repeat(150)} `)).toBeNull();
    expect(newContactProblem("x".repeat(151))).toBe(
      "Keep the supplier's name to 150 characters or fewer.",
    );
  });
});

describe("lineEdits (Edit Expense on a draft line)", () => {
  const wellcome = S("Wellcome");
  const park = S("ParknShop");
  const general = { id: "a-429", code: "429", name: "General Expenses" };
  const printing = { id: "a-461", code: "461", name: "Printing & Stationery" };
  const line: ExpenseLine = {
    id: "l1",
    item: "General Expenses",
    amount: 1200.5,
    description: "Milk",
    supplier: wellcome,
    account: general,
    receipts: [{ id: "r1", name: "milk.png", mime_type: "image/png" }],
  };
  const same = { amount: "1,200.50", description: "Milk", supplier: wellcome, account: general };

  it("sends nothing when nothing changed (grouping and spaces aside)", () => {
    expect(lineEdits(line, same)).toEqual({});
    expect(lineEdits(line, { ...same, amount: "1200.5", description: "  Milk " })).toEqual({});
  });
  it("sends only the fields that changed, by the API's names", () => {
    expect(lineEdits(line, { ...same, amount: "99.90" })).toEqual({ amount: "99.9" });
    expect(lineEdits(line, { ...same, description: "Milk and tea" })).toEqual({
      description: "Milk and tea",
    });
    expect(lineEdits(line, { ...same, supplier: park, account: printing })).toEqual({
      supplier_id: park.id,
      account_id: printing.id,
    });
  });
  it("sends an emptied description, so the API clears it", () => {
    expect(lineEdits(line, { ...same, description: "" })).toEqual({ description: "" });
  });
  it("picks a supplier or account for a line that had none", () => {
    expect(lineEdits({ ...line, supplier: null, account: null }, { ...same })).toEqual({
      supplier_id: wellcome.id,
      account_id: general.id,
    });
  });
});
