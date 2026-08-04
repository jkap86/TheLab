"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/**
 * A seat in the app bar that a page fills.
 *
 * The bar is one piece of global chrome mounted at the root layout, and the
 * controls worth putting in it belong to subtrees that mount far below it — the
 * ADP board's trigger reads a store the manager layout provides, drives a drawer
 * the manager layout renders, and shows a board the manager layout fetches. None
 * of that can move up to a layout that knows nothing about a manager, and
 * threading it down through two server layouts would put a tool's state in the
 * app's chrome. So the *part* travels instead: {@link HeaderSlotTarget} marks
 * where it lands and {@link HeaderSlot} portals it there.
 *
 * Three rules, and each is one this codebase already keeps somewhere else:
 *
 *  - **The server snapshot is null**, so nothing renders into the bar until
 *    after hydration. This is the {@link readLocal} store's rule applied to a
 *    DOM node: there is no bar on the server to portal into, and pretending
 *    otherwise is a hydration mismatch.
 *  - **An unfilled slot draws nothing.** The bar hides itself on `/tools` and
 *    most pages have no part to seat, so a target that is absent — or present
 *    and unfilled — has to be a bar with one less thing in it, not a hole.
 *  - **One seat, one occupant.** Two pages rendering into it would stack their
 *    parts silently, so the target is rendered once by `SiteHeader` and the
 *    filling is a page's own business — the manager layout fills it for all
 *    three tabs, which is exactly one occupant because the tabs are one layout.
 */
const listeners = new Set<() => void>();

let seat: HTMLElement | null = null;

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/**
 * Where the bar seats a page's part.
 *
 * Rendered by `SiteHeader`, once. It registers its own element on mount and
 * clears it on unmount — which is what makes the bar hiding itself on `/tools`
 * cost the occupant nothing beyond not being drawn. `flex` rather than a bare
 * div so an empty seat has no width of its own: with nothing in it the bar is
 * laid out exactly as it was before this existed.
 */
export function HeaderSlotTarget() {
  return (
    <div
      // The attribute is the bar's own hook, not a query selector for anyone
      // else: the wordmark hides its text below `sm` when this seat is filled
      // (`:not(:empty)`), which is a question only the bar can ask and only
      // about its own layout.
      data-header-seat=""
      className="flex min-w-0 items-center"
      ref={(element) => {
        seat = element;
        listeners.forEach((onStoreChange) => onStoreChange());
        return () => {
          if (seat === element) seat = null;
          listeners.forEach((onStoreChange) => onStoreChange());
        };
      }}
    />
  );
}

/**
 * Render `children` into the app bar's seat, from anywhere in the tree.
 *
 * The part stays a child of whatever mounts this as far as React is concerned —
 * it reads the same context, fires the same handlers and unmounts with the page
 * — and only its *box* is in the bar. That is the whole point: the ADP trigger
 * keeps talking to the manager's ADP store while sitting three layouts up.
 */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const target = useSyncExternalStore(
    subscribe,
    () => seat,
    () => null,
  );
  return target ? createPortal(children, target) : null;
}
