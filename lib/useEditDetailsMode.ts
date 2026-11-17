"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * A submitted report's Edit Details mode, shared by its summary and its step pages (owner,
 * 2026-11-17). `asked` is the address's `?edit=details` (report history's Edit, or the stepper while
 * editing): the page opens in the mode, then the address drops the parameter, so a reload is the
 * plain view. Whether the mode may show at all is the API's `permissions.edit_details`.
 */
export function useEditDetailsMode(asked: boolean): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [editing, setEditing] = useState(asked);
  useEffect(() => {
    if (!asked) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("edit");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [asked]);
  return [editing, setEditing];
}
