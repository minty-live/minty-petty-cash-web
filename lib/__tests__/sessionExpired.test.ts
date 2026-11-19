// "Your session has expired" (owner, 2026-11-19): a 401 whose body says `reason: session_expired`
// (the hub sign-in behind the token has ended - 60 minutes without activity, or signed out) goes
// through ONE call, `showSessionExpired(loginUrl)`, once however many calls fail together: the
// hub's sign-in page (accounts-api's front door) with `next` = the re-hand-off back to the page
// the person was on. Any other 401 still renews the token quietly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, mintyFetch, pettyCashFetch, subscriptionFetch } from "@/lib/apiClient";
import { getAuth, setAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { _resetHandoffForTests } from "@/lib/handoff";
import { _resetSessionExpiredForTests, isSessionExpired } from "@/lib/sessionExpired";

const ENTITY = "360812e1-9f94-46a3-aa31-347e21afde8e";
const TOKEN = "h.eyJ1c2VyX2lkIjoidTEifQ.s";
const fetchMock = vi.fn<typeof fetch>();
const handoff = vi.fn<(url: string) => void>();
const expired = vi.fn<(url: string) => void>();

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("a 401 whose sign-in has ended", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    _resetHandoffForTests(handoff);
    _resetSessionExpiredForTests(expired);
    setAuth(TOKEN, ENTITY, "Olive Shop");
    window.history.replaceState({}, "", "/entity/360812e1/olive-shop/petty-cash/report?step=2");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    handoff.mockReset();
    expired.mockReset();
    _resetHandoffForTests();
    _resetSessionExpiredForTests();
  });

  it("reads the reason off a 401's body", () => {
    expect(isSessionExpired({ error: "unauthorized", reason: "session_expired" })).toBe(true);
    expect(isSessionExpired({ error: "unauthorized" })).toBe(false);
    expect(isSessionExpired(null)).toBe(false);
  });

  it("says so once for calls failing together, with the way back to this page", async () => {
    fetchMock.mockImplementation(async () =>
      answer(401, { error: "unauthorized", reason: "session_expired" }),
    );

    const results = await Promise.allSettled([
      pettyCashFetch("/home"),
      mintyFetch("/api/me/profile"),
      subscriptionFetch("/api/me/subscriptions", { onUnauthorized: "reject" }),
    ]);

    expect(results.every((r) => r.status === "rejected" && r.reason instanceof ApiError)).toBe(
      true,
    );
    expect(handoff).not.toHaveBeenCalled(); // no quiet re-hand-off
    expect(expired).toHaveBeenCalledTimes(1);
    const target = new URL(expired.mock.calls[0][0]);
    expect(target.origin + target.pathname).toBe(env.ACCOUNTS_API_URL + "/");
    const back = new URL(target.searchParams.get("next") ?? "", env.ACCOUNTS_API_URL);
    expect(back.pathname).toBe("/handoff/petty-cash-web");
    expect(back.searchParams.get("next")).toBe(
      "/entity/360812e1/olive-shop/petty-cash/report?step=2",
    );
    expect(back.searchParams.get("entity_id")).toBe(ENTITY);
    expect(getAuth()).toBeNull();
  });

  it("a 401 without the reason still renews quietly", async () => {
    fetchMock.mockResolvedValueOnce(answer(401, { error: "unauthorized" }));

    await expect(pettyCashFetch("/home")).rejects.toBeInstanceOf(ApiError);

    expect(expired).not.toHaveBeenCalled();
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(new URL(handoff.mock.calls[0][0]).pathname).toBe("/handoff/petty-cash-web");
  });
});
