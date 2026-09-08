"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type RefObject,
} from "react";

import {
  COLLAPSE_MS,
  PARK_SETTLE_MS,
  PLATE_OVERHANG,
  SHELL_BREATH,
  STAND_BACK_MS,
  measureFreezeTop,
  parkedShell,
  prefersReducedMotion,
  scrollEase,
} from "./panel-cap";

/**
 * The open card is the screen, and the open card is a link.
 *
 * Pressing a card keeps the smooth scroll into place and then **locks the list
 * where it lands**: the page's header and every other card stand down, the
 * active card sits at the top under the rack, its expanded half takes the rest
 * of the viewport, and the page itself stops scrolling. Closing runs the same
 * thing backwards. Three tools mount this — `/manager`, `/lineupchecker` and
 * `/trades` — and the behaviour is one; what differs is which param names the
 * card and how tall the frozen header is.
 *
 * **The problem is a page, not a card.** An open card used to freeze its own
 * header under the rack and cap its panel while the rest of the list stayed in
 * flow behind it — so a reader inside a twelve-team browser was still scrolling
 * a hundred-league document, and nothing about which card was open survived a
 * reload or a link.
 *
 * **The URL is the state, and it is read as an external store rather than
 * copied into one.** `useSyncExternalStore` over `popstate` (and over this
 * module's own writes, which do not fire it) is what makes the open card a
 * *derived* value: there is no `active` state to keep in step with the address
 * bar, so a deeplink, a Back, a Forward and a press are one code path rather
 * than four that have to agree. It also settles the SSR question by
 * construction — the server snapshot is `null`, which is what the server would
 * have rendered anyway.
 *
 * It is deliberately not `useSearchParams`: that hook opts a route into dynamic
 * rendering and wants a Suspense boundary around it, which is a page-level cost
 * for a client-side disclosure. What this writes is `history.pushState` /
 * `replaceState`, which the App Router supports and which re-run no server
 * render.
 *
 * **Open is a history push, so Back closes.** Close pops the entry when this
 * view is the one that pushed it and `replace`s otherwise — a deeplinked card
 * was never pushed, and popping it would take the reader off the page.
 *
 * **The id is validated against the loaded list, and re-validated as it
 * grows.** `/manager` and `/lineupchecker` arrive over NDJSON, so an id that
 * matched nothing on mount can match a minute later; and a narrowing that
 * removes the open league is the same question answered the other way, which
 * is why the card closes when its id leaves the list rather than parking a
 * shell around nothing. Both fall out of `ids` being a render input rather than
 * something an effect watches.
 *
 * **What the DOM writes are, and why they are not renders.** The scroll lock is
 * `documentElement`'s; the shell's top padding belongs to the `<main>` that
 * `PageShell` renders from a *server* component two levels up; and the shell's
 * own height is the same measurement as that padding, applied to the other half
 * of the same box. Threading a prop through that seam for a client-side
 * disclosure is a worse trade than reaching for the `<main>` the list is
 * already inside — and the three are one measurement, so writing them together
 * is what stops the padding and the height from being taken a frame apart.
 * Nothing else writes any of them, so there is no render to race. Everything
 * the page *does* own — which cards stand down, the panel's cap — is rendered.
 * The writes are **layout effects**, which is what keeps them one frame with
 * the render: a passive effect runs after paint, so the list would be painted
 * once as a shell with no height and the page as a document with no lock —
 * the card jumping to the top of the page and back — before the write landed.
 *
 * **Nothing cuts.** The open and the close each pass through a stage in which
 * the rest of the page is on its way rather than there or gone: the other
 * cards and the header fade *during* the settle, so they are already invisible
 * when the shell makes them `display: none`; and they come back fading in over
 * the walk to where the reader pressed, so the un-park is not a page appearing
 * around a card. {@link ActiveCard.chromeClass} and the two stage attributes on
 * `shellProps` are how the page and the stylesheet read that — see
 * `globals.css`, which is where the fades are.
 */

/** What a page hands over, and what it gets back. */
export type ActiveCard = {
  /** The open card's id, or null. Held through the collapse, cleared after it. */
  active: string | null;
  /** True once the scroll has settled and the list has stood down. */
  parked: boolean;
  /** True for as long as the panel's collapse is running. */
  closing: boolean;
  /** Whether this card's disclosure is open — its panel is in the flow. */
  isOpen: (id: string) => boolean;
  /**
   * Whether this card's chrome is lit.
   *
   * **Not the same question as `isOpen`**, and the difference is the collapse:
   * the disclosure stays open for as long as the panel takes to close, so a
   * card lit off `[open]` would hold its border, halo and edge light through
   * the whole of it and let go afterwards. Lit is its own attribute, so the
   * card lets go *as* the panel closes — its own 450ms transitions running out
   * under the 300ms collapse.
   */
  isLit: (id: string) => boolean;
  /** A press on a card's summary. Drives the disclosure; the native one is not. */
  toggle: (id: string, event: MouseEvent<HTMLElement>) => void;
  /** Close whatever is open, from anywhere. */
  close: () => void;
  /**
   * Spread onto the list. While parked it marks the list as the shell, which is
   * what stands every other card down (`globals.css`) and what the panel
   * measures itself against (`usePanelCap`). Its *box* is written beside the
   * `<main>`'s padding rather than rendered — see the module note. Either side
   * of the park it carries the stage instead — settling, or returning — which
   * is what the other cards fade on.
   */
  shellProps: ShellProps;
  /**
   * For everything on the page that is not the list: the header, a rule, a
   * status pill. Empty at rest; a fade-out class while the card settles;
   * `hidden` while it is parked; a fade-in class while the page returns. A
   * page composes it onto each of those rather than reading `parked`, so the
   * header goes the way the other cards go rather than cutting to nothing
   * while they fade.
   */
  chromeClass: string;
};

/** Where the page is between at rest and parked, on the way in or out. */
type Stage = "idle" | "settling" | "parked" | "returning";

type ShellProps = {
  "data-card-shell"?: string;
  "data-card-settling"?: string;
  "data-card-returning"?: string;
};

const SHELL_PROPS: Record<Stage, ShellProps> = {
  idle: {},
  settling: { "data-card-settling": "" },
  parked: { "data-card-shell": "" },
  returning: { "data-card-returning": "" },
};

const CHROME_CLASS: Record<Stage, string> = {
  idle: "",
  settling: "lab-stand-down",
  parked: "hidden",
  returning: "lab-stand-back",
};

/** `useLayoutEffect` on the client, `useEffect` where there is no layout. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Walk the page to a line, a frame at a time, and say when it has arrived.
 *
 * Not `behavior: "smooth"`, and the reason is in `scrollEase`'s note: the
 * browser clamps a smooth scroll's destination to the document as it stands
 * when the call is made, and on a press the document is still growing under
 * the panel's unfold. `to` is read every frame and clamped to what the document
 * can reach *now*, so a card near the foot of the page is walked to where it
 * actually ends up rather than to where the page could reach when the reader
 * pressed. Under reduced motion it is one instant scroll and an immediate
 * arrival.
 *
 * Returns the cancel; an arrival that was cancelled never reports.
 */
function walkTo(
  to: () => number,
  duration: number,
  onArrive: () => void,
): () => void {
  const clamp = (line: number) => {
    const max = Math.max(
      0,
      (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight,
    );
    return Math.min(Math.max(0, line), max);
  };
  if (duration <= 0 || prefersReducedMotion()) {
    window.scrollTo({ top: clamp(to()), behavior: "auto" });
    onArrive();
    return () => {};
  }
  const from = window.scrollY;
  const started = performance.now();
  let frame = 0;
  const step = (now: number) => {
    const progress = scrollEase((now - started) / duration);
    const end = clamp(to());
    window.scrollTo({ top: from + (end - from) * progress, behavior: "auto" });
    if (progress < 1) {
      frame = requestAnimationFrame(step);
    } else {
      frame = 0;
      onArrive();
    }
  };
  frame = requestAnimationFrame(step);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
}

/**
 * `pushState` and `replaceState` fire no event, so this is the one they fire.
 *
 * Without it the store would go stale on exactly the writes this module makes —
 * a card opened by a press would be a URL nobody had read back, and the derived
 * `active` would still be null.
 */
const URL_EVENT = "thelab:urlchange";

function subscribeToUrl(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(URL_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(URL_EVENT, onChange);
  };
}

/** Read one query parameter, or null off the server. */
export function readQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

/**
 * Write one query parameter, keeping every other.
 *
 * `history` rather than the router: this changes nothing the server rendered,
 * and `router.replace` would re-run the route for a value only the browser
 * reads. `?season=` and the rest are carried through untouched.
 */
export function writeQueryParam(
  name: string,
  value: string | null,
  push = false,
): void {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams(window.location.search);
    if (value === null) params.delete(name);
    else params.set(name, value);
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  } catch {
    /* A sandboxed frame may refuse to write history; the card still opens. */
  }
  window.dispatchEvent(new Event(URL_EVENT));
}

/**
 * One query parameter, as a value that re-renders when it moves.
 *
 * The snapshot is a string or null — a primitive, so React's own `===` on it is
 * the whole of the caching `getSnapshot` is required to do, and there is no
 * object to rebuild per render.
 */
export function useUrlParam(name: string): string | null {
  const read = useCallback(() => readQueryParam(name), [name]);
  return useSyncExternalStore(subscribeToUrl, read, () => null);
}

export function useActiveCard({
  param,
  ids,
  listRef,
}: {
  /** `league` on the two league tools, `trade` on the board. */
  param: string;
  /**
   * The ids a card could be — the list as the reader can actually see it, so a
   * narrowing that removes the open card closes it, and an id that arrives with
   * a later page of the stream opens the deeplink that was waiting for it.
   */
  ids: readonly string[];
  /** The list itself. The shell, and the way to the `<main>` around it. */
  listRef: RefObject<HTMLElement | null>;
}): ActiveCard {
  const urlId = useUrlParam(param);
  const target = urlId !== null && ids.includes(urlId) ? urlId : null;

  /**
   * The card the URL has let go of but the panel is still collapsing.
   *
   * This is the whole of why `active` can be derived and still animate: the URL
   * changes the instant a close begins — on a press, on a Back, on a narrowing
   * — and something has to hold the card on screen for the 300ms after it.
   */
  const [closingId, setClosingId] = useState<string | null>(null);
  /** True during the walk into place, before the list stands down. */
  const [settling, setSettling] = useState(false);
  /**
   * The card the page is walking back from: set when a collapse ends with
   * nothing open, cleared once the other cards have faded back in.
   */
  const [returningId, setReturningId] = useState<string | null>(null);

  /**
   * A Back, or a narrowing that took the open card off the list, is a close
   * nobody pressed — and it has to start the same collapse a press does.
   *
   * Detected **during render** rather than from an effect, which is this
   * codebase's own idiom for adjusting state to an input that moved (see
   * `useManagerLeagues`): an effect would paint one frame of the list already
   * back around a card that has not begun to close. The timer that finishes it
   * is `useEffect`'s, below, because starting one is not something a render may
   * do.
   */
  const [seen, setSeen] = useState<string | null>(target);
  if (seen !== target) {
    setSeen(target);
    // The URL let a card go with nothing here having asked it to — the
    // browser's own Back, or a narrowing that took the open card off the list.
    // Hold it on screen and start the collapse. A close this view *pressed* has
    // already set `closingId` (see `close`, which cannot afford to wait for the
    // history traversal), and the guard is what keeps the two from being two
    // collapses.
    if (target === null) {
      if (seen !== null && closingId === null) setClosingId(seen);
    } else if (closingId !== null) {
      // Forward, or a press on another row: the close is off.
      setClosingId(null);
    }
  }

  const active = target ?? closingId;
  const closing = closingId !== null;
  // A card is parked from the moment the scroll settles until the collapse has
  // finished — so the list stays stood down under a panel that is still moving.
  const parked = active !== null && !settling;
  const stage: Stage =
    active !== null
      ? settling
        ? "settling"
        : "parked"
      : returningId !== null
        ? "returning"
        : "idle";

  /** Whether this view owns the history entry, and may therefore pop it. */
  const pushed = useRef(false);
  /**
   * Where to return the reader on close, or null for a card nobody pressed —
   * a deeplink — which has nowhere to walk back to and is left where it is.
   */
  const scrollAtPress = useRef<number | null>(null);
  /** The walk into place, so a close inside it can stop it. */
  const walk = useRef<(() => void) | null>(null);

  /**
   * Cancel a pending park **without declaring the settle over**.
   *
   * The difference matters for exactly one case, and it is a visible one:
   * closing inside the 340ms before the list has stood down. Clearing
   * `settling` there would make `parked` true on the very render the collapse
   * begins — the other cards would vanish, the panel would fold, and the whole
   * list would come back, all inside a third of a second. Left set, the card
   * never parks at all and the collapse runs in the ordinary list — whose
   * other cards are already fading, and fade back on the return like any
   * other close. The close's own timer is what clears it.
   */
  const cancelPark = useCallback(() => {
    walk.current?.();
    walk.current = null;
  }, []);

  const open = useCallback(
    (id: string, li: HTMLElement | null) => {
      // Read the URL rather than closing over the derived value: it is the same
      // source of truth and it keeps this callback's identity stable, which is
      // what a board of memo'd trade cards is relying on.
      const current = readQueryParam(param);
      // Pushed only when opening from nothing: switching cards would otherwise
      // leave Back walking through every card the reader had looked at.
      const push = current === null;

      // **Only on the press that opens from nothing.** Switching cards happens
      // inside the settle, mid-walk, so re-reading here would replace the row
      // the reader actually came from with wherever the animation had got to.
      if (push) scrollAtPress.current = window.scrollY;
      setClosingId(null);
      setReturningId(null);
      setSettling(true);
      writeQueryParam(param, id, push);
      if (push) pushed.current = true;

      // **The walk and the wait for it are one decision.** The list stands
      // down when the walk arrives — which under reduced motion is at once, so
      // the card parks against a page that has already arrived rather than a
      // third of a second later.
      cancelPark();
      const freezeTop = measureFreezeTop();
      const line = li
        ? () => window.scrollY + li.getBoundingClientRect().top - freezeTop
        : () => window.scrollY;
      walk.current = walkTo(line, PARK_SETTLE_MS, () => {
        walk.current = null;
        setSettling(false);
      });
    },
    [param, cancelPark],
  );

  /**
   * Close: the URL lets the card go, and the render-time branch above turns
   * that into the collapse.
   *
   * The history write is at the *start* rather than the end, which is what
   * makes a press and a Back the same thing from here on: both leave the URL
   * naming no card while `closingId` holds it on screen.
   */
  const close = useCallback(() => {
    const id = readQueryParam(param);
    if (id === null) return;
    cancelPark();
    // **The collapse begins here, not when the URL catches up**, and that is a
    // measurement rather than a shortcut. Popping a history entry is a
    // same-document traversal Chrome queues as a task: driven, `back()` took
    // **220ms** to deliver its `popstate`, against the collapse — so a close
    // that waited for the URL sat still for most of its own animation and then
    // vanished. Setting it here costs nothing in correctness, because the
    // render-time branch below is guarded on this being unset: whichever of the
    // two notices first, the card collapses exactly once.
    setClosingId(id);
    if (pushed.current) {
      // Pop the entry this view pushed, so the address bar and the history
      // stack agree about there being nothing open.
      pushed.current = false;
      window.history.back();
    } else {
      writeQueryParam(param, null);
    }
  }, [param, cancelPark]);

  const toggle = useCallback(
    (id: string, event: MouseEvent<HTMLElement>) => {
      // **The disclosure is driven, not native.** The list has to change with
      // it, and a `<details>` that toggled itself would be open for a frame
      // before the page knew.
      event.preventDefault();
      // The URL rather than the derived value, for `open`'s reason: it is the
      // same source of truth and reading it here is what keeps this callback's
      // identity stable across a render of the whole board.
      if (readQueryParam(param) === id) {
        close();
        return;
      }
      open(id, event.currentTarget.closest("li"));
    },
    [close, open, param],
  );

  /**
   * The collapse's own clock.
   *
   * When it runs out the URL has let the card go and nothing has put another
   * back, so the page begins its return: the list comes back around the card
   * and the walk back to where the reader pressed starts — both in the layout
   * effect below, on the same frame, so the card never paints anywhere but
   * where it was.
   */
  useEffect(() => {
    if (closingId === null) return;
    const id = closingId;
    const timer = setTimeout(() => {
      setClosingId(null);
      // Whatever `cancelPark` left standing — see it for why it does not.
      setSettling(false);
      // Something put a card back inside the collapse — a Forward, or a press
      // on another row. The page is where it should be; leave it alone.
      if (readQueryParam(param) !== null) return;
      setReturningId(id);
    }, COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [closingId, param]);

  /**
   * The return: land the page where the card already is, then walk it back.
   *
   * **A layout effect, and the order inside the commit is the whole of it.**
   * The render that starts the return is the one that un-parks: React removes
   * the shell attribute and shows the other cards in the mutation phase, runs
   * the park effect's cleanup (which hands the `<main>` and the list their own
   * boxes back) in the same phase, and only then runs this — so the card's
   * line is read from a document that is whole again, and the instant scroll
   * that keeps the card where the reader is looking lands before anything is
   * painted. Released outright the document is at scroll 0 with a hundred
   * cards above the one being read, and a passive effect would have painted
   * exactly that for a frame.
   *
   * The walk back reads as the press undone, and the other cards fade in over
   * it. A deeplinked card has no press to undo, so the page stays on it.
   */
  useIsomorphicLayoutEffect(() => {
    if (returningId === null) return;
    const card =
      listRef.current?.querySelector<HTMLElement>(
        `li[data-card="${CSS.escape(returningId)}"]`,
      ) ?? null;
    const main = listRef.current?.closest("main");
    let rest = 0;
    let slack = 0;
    if (card && card.isConnected) {
      const here = Math.max(
        0,
        card.getBoundingClientRect().top + window.scrollY - measureFreezeTop(),
      );
      // **A card near the foot of the page cannot stay where it was parked**,
      // because the document under it is too short to scroll that far — so
      // without help it would jump down the screen the instant the list came
      // back, which is the one cut the return would still have. The page is
      // lent exactly the slack it is short, as padding under the `<main>`, for
      // the length of the walk; the walk's own destination is always reachable
      // without it (it is a line the page stood at before), so taking the
      // slack away at the end moves nothing.
      const reach = Math.max(
        0,
        (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight,
      );
      slack = Math.max(0, here - reach);
      if (slack > 0 && main instanceof HTMLElement) {
        const own = Number.parseFloat(getComputedStyle(main).paddingBottom) || 0;
        main.style.paddingBottom = `${own + slack}px`;
      }
      window.scrollTo({ top: here, behavior: "auto" });
      // Where the card can rest once the slack goes: a deeplinked card, which
      // has no press to walk back to, is walked here rather than left to drop.
      rest = here - slack;
    }
    const to = scrollAtPress.current ?? rest;
    scrollAtPress.current = null;
    const release = () => {
      if (main instanceof HTMLElement) main.style.paddingBottom = "";
    };
    const cancel = walkTo(
      () => to,
      STAND_BACK_MS,
      () => {
        release();
        setReturningId(null);
      },
    );
    return () => {
      cancel();
      release();
    };
  }, [returningId, listRef]);

  /* ── The park's own DOM: the lock, the shell's box, the resize ────── */

  useIsomorphicLayoutEffect(() => {
    if (!parked) return;
    const root = document.documentElement;
    const body = document.body;
    const list = listRef.current;
    const main = list?.closest("main");

    // The list is a fixed box under the rack now, so there is nothing above it
    // to scroll to.
    window.scrollTo({ top: 0 });
    const rootOverflow = root.style.overflow;
    const bodyOverflow = body.style.overflow;
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";

    /**
     * One measurement, applied to the two halves of one box.
     *
     * The shell opens at the **plate's** line and carries the overhang as its
     * own padding, so the `<main>` above it stops short by exactly that: clipped
     * to the housing's edge instead, every league's name would lose its top
     * third to the plate that hangs above it.
     */
    const apply = () => {
      const box = parkedShell(window.innerHeight, measureFreezeTop());
      if (main instanceof HTMLElement) {
        main.style.paddingTop = `${box.top}px`;
        main.style.paddingBottom = `${SHELL_BREATH}px`;
      }
      if (list) {
        // **Its own margins go, and that is a measurement rather than
        // tidiness.** Every one of these lists carries a rhythm margin above it
        // (`/manager`'s `mt-2`) for the gap between the rule and the first
        // card, and parked that margin sits between the `<main>` padding and
        // the shell — so the card lands 8px below the offset the park scrolled
        // it to, the shell overhangs the fold by the same 8, and the breath
        // under it is half what it was asked for. Measured: the plate parked at
        // 89 against a 81px offset until this line.
        list.style.marginTop = "0px";
        list.style.marginBottom = "0px";
        list.style.height = `${box.height}px`;
        list.style.paddingTop = `${PLATE_OVERHANG}px`;
        // Used only where the panel hit its floor — see `panelFit`. `auto`
        // rather than a computed `hidden`/`auto` because the two answers are the
        // same one: nothing overflows when the panel fits.
        list.style.overflowY = "auto";
      }
    };
    apply();

    // Both terms are functions of `innerHeight`: a window dragged taller, or a
    // phone's URL bar retracting, changes the shell without changing anything a
    // `ResizeObserver` on the card could see.
    window.addEventListener("resize", apply);

    return () => {
      window.removeEventListener("resize", apply);
      root.style.overflow = rootOverflow;
      body.style.overflow = bodyOverflow;
      if (main instanceof HTMLElement) {
        main.style.paddingTop = "";
        main.style.paddingBottom = "";
      }
      if (list) {
        list.style.marginTop = "";
        list.style.marginBottom = "";
        list.style.height = "";
        list.style.paddingTop = "";
        list.style.overflowY = "";
      }
    };
  }, [parked, listRef]);

  /* ── Escape, and the settle timer ────────────────────────────────── */

  useEffect(() => {
    if (active === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A modal on top owns Escape — a shares drawer opened from the rack sits
      // above a parked card, and closing the card out from under it would leave
      // the reader in a dialog over a page they did not ask to return to.
      if (document.querySelector("dialog[open]")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close]);

  useEffect(
    () => () => {
      walk.current?.();
      walk.current = null;
    },
    [],
  );

  return {
    active,
    parked,
    closing,
    isOpen: (id) => active === id,
    isLit: (id) => active === id && !closing,
    toggle,
    close,
    shellProps: SHELL_PROPS[stage],
    chromeClass: CHROME_CLASS[stage],
  };
}
