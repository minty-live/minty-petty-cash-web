// This app's sidebar host (../sidebarHost.ts): where the menu leads FROM Petty Cash.

import { afterEach, describe, expect, it, vi } from "vitest";

import { draftKey, writeDraft } from "@minty/shared/drafts";

import { sidebarHost } from "@/components/ui/sidebarHost";
import { setAuth } from "@/lib/auth";
import { _resetHandoffForTests } from "@/lib/handoff";

const ENTITY = "360812e1-9f94-46a3-aa31-347e21afde8e";
const HOME = "/entity/360812e1/olive-and-vine/petty-cash";

afterEach(() => _resetHandoffForTests());

describe("the menu's links", () => {
  it("keeps the dashboard and Reports in this app; Settings is the hub's Petty Cash Settings tab", () => {
    setAuth("tok", ENTITY, "Olive & Vine");
    expect(sidebarHost.links.pettyCashDashboard()).toBe(HOME);
    expect(sidebarHost.links.pettyCashReports(ENTITY)).toBe(`${HOME}/reports`);
    const settings = new URL(sidebarHost.links.settings());
    expect(settings.origin + settings.pathname).toBe("http://localhost:8000/handoff/minty-web");
    expect(settings.searchParams.get("next")).toBe(
      "/entity/360812e1/olive-and-vine/settings/petty-cash",
    );
  });

  it("reaches minty-web's pages and the payments app through Flask", () => {
    setAuth("tok", ENTITY, "Olive & Vine");
    const entities = new URL(sidebarHost.links.entities());
    expect(entities.origin + entities.pathname).toBe("http://localhost:8000/handoff/minty-web");
    expect(entities.searchParams.get("next")).toBe("/entities");
    expect(new URL(sidebarHost.links.subscriptions()).searchParams.get("next")).toBe(
      "/subscription",
    );
    expect(new URL(sidebarHost.links.bills()).pathname).toBe(`/entity/${ENTITY}/payment-request`);
    // no profile link: My Profile opens only in the sidebar (@minty/shared v0.12)
    expect("profile" in sidebarHost.links).toBe(false);
  });

  it("marks Dashboard and Reports current on their own pages (owner, 2026-11-18), Settings never", () => {
    expect(sidebarHost.currentOf(HOME)).toBe("dashboard");
    expect(sidebarHost.currentOf(`${HOME}/`)).toBe("dashboard");
    expect(sidebarHost.currentOf(`${HOME}/reports`)).toBe("reports");
    expect(sidebarHost.currentOf(`${HOME}/reports/new/opening`)).toBe("reports");
    expect(sidebarHost.currentOf("/entity/360812e1/olive-and-vine/settings/petty-cash")).toBeNull();
    expect(sidebarHost.currentOf(`${HOME}/settings`)).toBeNull();
  });
});

describe("logging out", () => {
  it("forgets the token and ends the session at Flask with a POST (a GET answers 405)", async () => {
    setAuth("tok", ENTITY, "Olive & Vine");
    const go = vi.fn();
    _resetHandoffForTests(go);
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    sidebarHost.logOut();
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(document.cookie).not.toContain("petty_cash_token=tok");
    const form = submit.mock.contexts[0] as HTMLFormElement;
    expect(form.getAttribute("method")).toBe("POST");
    expect(form.getAttribute("action")).toBe("http://localhost:8000/logout");
    expect(go).not.toHaveBeenCalled();
  });
});

describe("logging out and the auto-saved drafts (2026-11-20)", () => {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  const token = `${b64({ alg: "HS256" })}.${b64({ user_id: "u-ann", entity_id: ENTITY })}.sig`;
  const draft = (userId: string, form: string) => {
    const key = draftKey({ userId, entityId: ENTITY }, form, "2026-11-16");
    writeDraft(key, {
      v: 1,
      form,
      record: "2026-11-16",
      shape: 1,
      userId,
      entityId: ENTITY,
      savedAt: Date.now(),
      basedOn: "3",
      value: { cash: "50" },
      files: [],
      missing: [],
    });
    return key;
  };

  it("removes this person's drafts BEFORE the token goes; another person's stay", async () => {
    window.localStorage.clear();
    setAuth(token, ENTITY, "Olive & Vine");
    const mine = draft("u-ann", "pc.sales");
    const theirs = draft("u-bob", "pc.sales");
    _resetHandoffForTests(vi.fn());
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    sidebarHost.logOut();
    // the drafts went at once; the token is still here until that is done
    expect(window.localStorage.getItem(mine)).toBeNull();
    expect(window.localStorage.getItem(theirs)).not.toBeNull();
    expect(document.cookie).toContain("petty_cash_token=");
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(document.cookie).not.toContain("petty_cash_token=");
  });
});
