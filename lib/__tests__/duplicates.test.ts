// The duplicate reminder (owner's decisions doc DUP1, 2026-11-19): reading the API's 409.

import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/apiClient";
import { duplicatesOf } from "@/lib/duplicates";

const SENTENCE =
  "This looks like an expense you already have on this day: the same supplier and amount. Save it anyway?";
const MATCH = { id: "e2", description: "Copy paper", amount: "1012.50", supplier: "ABC Supplies" };

describe("duplicatesOf", () => {
  it("reads the sentence and the matching lines", () => {
    const err = new ApiError(409, SENTENCE, { error: SENTENCE, duplicates: [MATCH] });
    expect(duplicatesOf(err)).toEqual({ sentence: SENTENCE, duplicates: [MATCH] });
  });

  it("is null for another 409, another status, or an empty list", () => {
    expect(duplicatesOf(new ApiError(409, "x", { error: "x", to: "opening" }))).toBeNull();
    expect(duplicatesOf(new ApiError(400, "x", { error: "x", duplicates: [MATCH] }))).toBeNull();
    expect(duplicatesOf(new ApiError(409, "x", { error: "x", duplicates: [] }))).toBeNull();
    expect(duplicatesOf(new Error("offline"))).toBeNull();
  });
});
