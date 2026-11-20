import { draftScopeFromToken, type DraftScope } from "@minty/shared/drafts";

import { getAuth } from "@/lib/auth";

/**
 * Whose auto-saved drafts a form keeps (`@minty/shared/drafts`): the person and company this app's
 * module token names (its `user_id` and `entity_id` claims, lib/auth.ts). Null with no token: no
 * draft is kept or offered. Read once per form (a `useState` initialiser), not on every render.
 */
export function currentDraftScope(): DraftScope | null {
  return draftScopeFromToken(getAuth()?.token);
}
