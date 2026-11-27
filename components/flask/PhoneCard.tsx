"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { NavMenu, ViewerBadge } from "@minty/shared/sidebar";
import { HeaderBack, HeaderCompany } from "@minty/shared/ui";

import { useMounted } from "@/components/ui/Sidebar";
import { sidebarHost } from "@/components/ui/sidebarHost";

/**
 * Petty Cash's page frame, laid out as every app's page (the user, 2026-11-27: "header takes up
 * whole screen and the scroll at the border same way as other apps"):
 *
 * - **The header bar** spans the window, white with a hairline under it, and stays at the top -
 *   minty-web's `AppHeader` / Payment Request's `Header`: "‹ Back" (`@minty/shared`'s
 *   `HeaderBack`) and the page's name on the left; the company (`HeaderCompany`), the person's
 *   initials (My Profile) and the ≡ on the right (the shared sidebar's `ViewerBadge` and
 *   `NavMenu`, classic look).
 * - **The band under it**, held at the top with it: a report's day and status badge, the step's
 *   stepper (`stepper`) or report history's date filter (`toolbar`, drawn as given).
 * - **The page**: white, with the content in Flask's grey phone card - full width on a phone,
 *   640 / 768 / 1024 px centred above (`.flask-main-container`), the screen's height, shadowed
 *   (the user, 2026-11-27: "keep the body a white background while the main column is wrapped in
 *   the card"). The card is a fixed backdrop, so it stays whole as the page scrolls past it; one
 *   scroll, the document's, so the scroll bar is at the window's edge. `overlays`
 *   (Flask's modals, `absolute inset-0`) sit in a frame the column's width and the screen's
 *   height. `flush`: the content pads itself (report history).
 *
 * The dashboard (`home`) is the app's main page: no way back, as Payment Request's list.
 *
 * A shared report (`publicView`, Flask's `is_shared_link`): the name and the company only - no way
 * back, no initials, no menu, so no read of the person (the page has no token) and nowhere to go.
 */
export function PhoneCard({
  company,
  title = "Petty Cash",
  children,
  overlays,
  datePill,
  badge,
  stepper,
  toolbar,
  flush = false,
  backHref,
  backSkip,
  home = false,
  publicView = false,
}: {
  /** The company's name, at the bar's right. */
  company: string;
  /** The page's name, beside the way back. */
  title?: string;
  children: ReactNode;
  overlays?: ReactNode;
  /** A report's day: "01 SEP". */
  datePill?: string;
  /** A report's Draft / Submitted / Published badge. */
  badge?: ReactNode;
  stepper?: ReactNode;
  /** Report history: its date filter under the header, outside the page's content. */
  toolbar?: ReactNode;
  /** The content pads itself: only Flask's room at the bottom (`pb-40`). */
  flush?: boolean;
  /**
   * Where Back goes when nothing in this app came before the page (a link, a new tab): it goes
   * back to the page the person came from (`@minty/shared/backLink`). Without it, the company
   * list, always (the dashboard's).
   */
  backHref?: string;
  /** Pages Back steps over (the wizard's own steps - `WIZARD_BACK_SKIP`). */
  backSkip?: RegExp[];
  /** The app's main page (the dashboard): no way back, as Payment Request's list (the user, 2026-11-27). */
  home?: boolean;
  /** A shared report: no way back, no person's initials, no menu. */
  publicView?: boolean;
}) {
  // The companies link reads the cookie and the page's origin, which the server does not have:
  // drawn without an address until the browser has taken over, so both renders agree.
  const mounted = useMounted();
  // A scrollIntoView({block: "start"}) lands under the sticky top, not behind it: the window's
  // scroll padding follows the top's height (the band wraps on a phone).
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = top.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const set = () => {
      root.style.scrollPaddingTop = `${el.offsetHeight}px`;
    };
    set();
    const watch = new ResizeObserver(set);
    watch.observe(el);
    return () => {
      watch.disconnect();
      root.style.scrollPaddingTop = "";
    };
  }, []);
  const day = datePill || badge;
  return (
    <div className="relative flex min-h-screen min-w-0 flex-col bg-flask-white">
      {/* The card behind the column: the screen's height wherever the page is scrolled. */}
      <div
        aria-hidden
        data-phone-card
        className="flask-main-container pointer-events-none fixed inset-x-0 inset-y-0 z-0 mx-auto bg-flask-gray-50 shadow-flask-xl"
      />
      <div ref={top} data-phone-card-top className="sticky top-0 z-20 flex-shrink-0">
        <header className="border-b border-border-default bg-flask-white pt-[env(safe-area-inset-top,0px)]">
          <div className="mx-auto flex h-16 w-full max-w-[1920px] items-center justify-between gap-2 px-4 sm:h-18 sm:gap-3 sm:px-6">
            {/* The way back and the name stay whole; the company's side gives way (AppHeader's rule). */}
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              {publicView || home ? null : backHref ? (
                <HeaderBack href={backHref} skip={backSkip} />
              ) : (
                <HeaderBack
                  href={mounted ? sidebarHost.links.entities() : ""}
                  direct
                  ariaLabel="Back to your companies"
                />
              )}
              <h1 className="shrink-0 cursor-default whitespace-nowrap text-base font-semibold text-text-primary sm:text-lg">
                {title}
              </h1>
            </div>
            <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-3">
              {company ? <HeaderCompany name={company} /> : null}
              {publicView ? null : (
                <div className="flex shrink-0 items-center gap-1.5 pl-0.5 sm:gap-2 sm:pl-2">
                  <ViewerBadge />
                  <NavMenu />
                </div>
              )}
            </div>
          </div>
        </header>
        {day || stepper || toolbar ? (
          <div data-phone-card-band>
            <div className="flask-main-container bg-flask-gray-50">
              {day ? (
                <div className="flex flex-wrap items-center gap-2 px-4 pt-3 sm:px-6">
                  {datePill ? (
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-flask-teal-soft/50 px-2 py-1 text-xs font-medium text-flask-teal-pill sm:px-3">
                      {datePill}
                    </span>
                  ) : null}
                  {badge}
                </div>
              ) : null}
              {stepper ? <div className="px-4 py-2 sm:px-6">{stepper}</div> : null}
              {toolbar}
            </div>
          </div>
        ) : null}
      </div>
      <div
        data-phone-card-content
        className={`flask-main-container relative z-[1] flex-1 overflow-x-clip ${flush ? "" : "p-6"} pb-40`}
      >
        {children}
      </div>
      {overlays ? (
        // The column's width, the screen's height: Flask's modals cover what the person sees,
        // wherever the page is scrolled. Clicks pass through where no modal is open.
        <div className="flask-main-container pointer-events-none fixed inset-x-0 inset-y-0 z-40 mx-auto [&>*]:pointer-events-auto">
          {overlays}
        </div>
      ) : null}
    </div>
  );
}
