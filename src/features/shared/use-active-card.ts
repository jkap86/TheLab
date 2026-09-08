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
  FLIGHT_EASE,
  FLIGHT_MS,
  PLATE_OVERHANG,
  SHELL_BREATH,
  measureFreezeTop,
  parkedShell,
  prefersReducedMotion,
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
   * Spread onto the list. **A constant**, which is the whole point of it: it
   * marks the list for the stylesheet and for {@link usePanelCap}, and the
   * *stage* is written onto the page's `<main>` imperatively rather than
   * rendered — see {@link ActiveCard.chromeClass} and the module note.
   */
  shellProps: ShellProps;
  /**
   * For everything on the page that is not the list: the header, a rule, a
   * status pill. **A constant too**, and for a measured reason.
   *
   * It used to be the stage as a class — `lab-stand-down`, `hidden`,
   * `lab-stand-back` — which meant every stage change re-rendered the page, and
   * a page is a hundred league cards. Measured on a hundred-card fixture, one
   * such render blocked the main thread for 50–90ms and a close spent four of
   * them: 402ms of blocking across a 300ms animation, so the animation ran at
   * about six frames. The stage is a *presentational* fact with exactly one
   * writer, which is the same argument the scroll lock and the shell's box are
   * already DOM writes by — so it is one attribute on the `<main>` and the
   * stylesheet does the rest, and a page renders only when the open card
   * actually changes.
   */
  chromeClass: string;
};

/**
 * Where the page is: at rest, or with one card holding the screen.
 *
 * **There were four**, `settling` and `returning` either side of the park,
 * because the page used to scroll the card into place over ~340ms and only
 * then stand the list down. That is what put the list's own layout — hiding a
 * hundred cards, then showing them again — *inside* the animation: measured on
 * a hundred-card fixture, 139ms of blocked main thread landing at +283ms and
 * +361ms of a 340ms walk, and the same again on the way back. The park is one
 * discrete layout and it cannot be made cheap, so it happens **once, on the
 * press**, and what moves afterwards is a transform on the one card. See
 * {@link ActiveCard.parked}.
 */
type Stage = "idle" | "parked";

type ShellProps = { "data-card-list": string };

/** Marks the list for the stylesheet and for the panel's own measurement. */
const SHELL_PROPS: ShellProps = { "data-card-list": "" };

/**
 * Marks the page's own chrome — header, rule, pills — for the stylesheet.
 *
 * What it does is decided by the stage on the `<main>` above it, so the class
 * never changes and neither does the element that carries it.
 */
const CHROME_CLASS = "lab-card-chrome";

/** The one attribute the stylesheet reads, and the one writer of it. */
function writeStage(main: Element | null | undefined, stage: Stage): void {
  if (!(main instanceof HTMLElement)) return;
  if (stage === "idle") delete main.dataset.cardStage;
  else main.dataset.cardStage = stage;
}

/** `useLayoutEffect` on the client, `useEffect` where there is no layout. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Fly a card from where it was to where it now is.
 *
 * The park has already happened, so the card is standing at its final line and
 * the browser has laid the page out around it; this only puts it back where the
 * reader last saw it and lets it travel. A transform and nothing else, so the
 * motion is the compositor's and a hundred-card list cannot stutter it — which
 * is the whole of what {@link FLIGHT_MS} is for.
 *
 * A card that has not moved gets no animation, which is the deeplink's case and
 * the case of pressing a card already on the park line.
 */
function flyCard(card: HTMLElement, from: number, to: number): Animation | null {
  const delta = Math.round(from - to);
  if (!delta || prefersReducedMotion()) return null;
  return card.animate(
    [{ transform: `translateY(${delta}px)` }, { transform: "none" }],
    { duration: FLIGHT_MS, easing: FLIGHT_EASE },
  );
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
   * — and something has to hold the card on screen for the collapse after it.
   */
  const [closingId, setClosingId] = useState<string | null>(null);

  /**
   * The card the page is closing, held past the point `seen` lets go of it.
   *
   * **`seen` is not usable here and that is a bug this had.** The URL drops the
   * card the moment a close begins — a press writes it away, and the browser's
   * own Back delivers its `popstate` about 220ms later — so by the time the
   * collapse's timer runs out, `seen` has been null for a while and the return
   * had no card to look up. It found nothing and the card jumped home instead
   * of being left where it was, which is the cut this exists to remove. Written
   * by the collapse's own effect, which is the one place every kind of close
   * passes through.
   */
  const leavingId = useRef<string | null>(null);

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

  /* ── The stage, which is a DOM write rather than a render ──────────
   *
   * `settling`, `parked` and `returning` used to be React state, and on a page
   * that is one card per league that made every step of the open and the close
   * a re-render of the whole list — 50–90ms of blocked main thread each, four
   * of them on a close. They are a ref and one attribute now; the two things
   * that genuinely change what React renders, `active` and `closing`, are the
   * only state left.
   */

  const stage = useRef<Stage>("idle");
  /** Whether this view owns the history entry, and may therefore pop it. */
  const pushed = useRef(false);
  /** Whichever flight is running, so the next one can cancel it. */
  const flight = useRef<Animation | null>(null);
  /**
   * Where the pressed card's top edge was, in the viewport, at the moment of
   * the press — read in the handler, because by the time the layout effect runs
   * the park has already moved it. Null for a card nobody pressed.
   */
  const flewFrom = useRef<number | null>(null);
  /** Restores the `<main>`, the list and the lock. Set while parked. */
  const unpark = useRef<(() => void) | null>(null);

  const stopFlight = useCallback(() => {
    flight.current?.cancel();
    flight.current = null;
  }, []);

  /**
   * Give the parked shell its scroller back once the card has landed.
   *
   * A scroll container clips a translated child, so the list runs `visible`
   * while a card is in flight — see `park`. This is the other half of that, and
   * it is `finished` rather than a timer so a cancelled flight never restores a
   * scroller onto a page that has since un-parked.
   */
  const landFlight = useCallback(() => {
    const grant = () => {
      const list = listRef.current;
      if (list && stage.current === "parked") list.style.overflowY = "auto";
    };
    const run = flight.current;
    // A card that had nowhere to travel — a deeplink, or one already on the
    // line — is landed already.
    if (!run) {
      grant();
      return;
    }
    run.finished
      .then(() => {
        if (flight.current !== run) return;
        flight.current = null;
        grant();
      })
      .catch(() => {});
  }, [listRef]);

  /**
   * Lock the page and make the list the parked shell.
   *
   * The three writes are one measurement applied to two halves of one box —
   * see the module note — and they are imperative for the reason the stage is:
   * nothing else writes them, so there is no render to race, and threading them
   * through a server component's `<main>` for a client-side disclosure is the
   * worse trade.
   */
  const park = useCallback(() => {
    if (unpark.current) return;
    const root = document.documentElement;
    const body = document.body;
    const list = listRef.current;
    const main = list?.closest("main");

    window.scrollTo({ top: 0, behavior: "auto" });
    const rootOverflow = root.style.overflow;
    const bodyOverflow = body.style.overflow;
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";

    const apply = () => {
      const box = parkedShell(window.innerHeight, measureFreezeTop());
      if (main instanceof HTMLElement) {
        main.style.paddingTop = `${box.top}px`;
        main.style.paddingBottom = `${SHELL_BREATH}px`;
      }
      if (list) {
        // Its own rhythm margins go, or the card lands that far below the line
        // the park scrolled it to and the shell overhangs the fold by the same.
        list.style.marginTop = "0px";
        list.style.marginBottom = "0px";
        list.style.height = `${box.height}px`;
        list.style.paddingTop = `${PLATE_OVERHANG}px`;
        // The scroller is the flight's to grant — see `landFlight`. A scroll
        // container clips a translated child, and a card starts its flight
        // offset by however far it has to travel, so the shell runs `visible`
        // until it lands. `panelFit`'s floor is the only case that ever needs
        // to scroll at all, and it needs it after the motion rather than during.
        list.style.overflowY = "visible";
      }
    };
    apply();
    // Both terms are functions of `innerHeight`: a window dragged taller, or a
    // phone's URL bar retracting, changes the shell without changing anything a
    // `ResizeObserver` on the card could see.
    window.addEventListener("resize", apply);

    unpark.current = () => {
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
      unpark.current = null;
    };
  }, [listRef]);

  /** Move to a stage: write the attribute, and do that stage's DOM work. */
  const toStage = useCallback(
    (next: Stage) => {
      if (stage.current === next) return;
      stage.current = next;
      const list = listRef.current;
      writeStage(list?.closest("main"), next);
      // The panel re-measures itself off the list's own box, which the park
      // gives a fixed height — so its `ResizeObserver` is what notices, and
      // that render is the open card's alone rather than the page's.
      if (next === "parked") park();
      else unpark.current?.();
    },
    [listRef, park],
  );

  const open = useCallback(
    (id: string, li: HTMLElement | null) => {
      // Read the URL rather than closing over the derived value: it is the same
      // source of truth and it keeps this callback's identity stable, which is
      // what a board of memo'd trade cards is relying on.
      const current = readQueryParam(param);
      // Pushed only when opening from nothing: switching cards would otherwise
      // leave Back walking through every card the reader had looked at.
      const push = current === null;

      // **Read before the commit, because the park is what moves it.** This is
      // where the card is on screen as the reader presses it; the layout effect
      // below reads where it has landed and flies it between the two.
      flewFrom.current = li ? li.getBoundingClientRect().top : null;
      leavingId.current = null;

      setClosingId(null);
      writeQueryParam(param, id, push);
      if (push) pushed.current = true;
    },
    [param],
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
    // A close inside the flight cancels it: the card is where it is, and the
    // collapse runs from there.
    stopFlight();
    // **The collapse begins here, not when the URL catches up.** Popping a
    // history entry is a same-document traversal the browser queues as a task —
    // driven, `back()` took 220ms to deliver its `popstate` against a 300ms
    // collapse — so a close that waited for the URL sat still for most of its
    // own animation and then vanished. The render-time branch above is the
    // fallback, guarded on this being unset, so the card collapses exactly once.
    setClosingId(id);
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      writeQueryParam(param, null);
    }
  }, [param, stopFlight]);

  const toggle = useCallback(
    (id: string, event: MouseEvent<HTMLElement>) => {
      // **The disclosure is driven, not native.** The list has to change with
      // it, and a `<details>` that toggled itself would be open for a frame
      // before the page knew.
      event.preventDefault();
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
   * back, so the page returns: the list comes back around the card, the page is
   * landed where the card already is, and the walk back to where the reader
   * pressed begins. All of it in the layout effect below rather than a render,
   * so the card never paints anywhere but where it was.
   */
  useEffect(() => {
    if (closingId === null) return;
    // **Read the parked line here, because this is the last moment it can be
    // read.** By the time the return runs, `active` is null, so the card's own
    // disclosure is shut and the parked rule has already taken it off the page
    // — and `getBoundingClientRect()` on a `display: none` element is four
    // zeroes rather than a position. Driven, that is exactly what it answered:
    // the card was scrolled to as though it had been sitting at the top of the
    // viewport, which put it 81px out on every close. Nothing moves it between
    // here and there — it is parked for the whole of the collapse.
    // Both are read here rather than where the close was asked for, because
    // this is the one place that runs for every way a card can close — a press,
    // the browser's own Back, and a narrowing that takes the card off the list
    // — and it is not a render, which may not write a ref at all.
    leavingId.current = closingId;
    flewFrom.current =
      listRef.current
        ?.querySelector<HTMLElement>(`li[data-card="${CSS.escape(closingId)}"]`)
        ?.getBoundingClientRect().top ?? null;
    const timer = setTimeout(() => setClosingId(null), COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [closingId, listRef]);

  /**
   * The open: park on the press, then fly the card to the line.
   *
   * **A layout effect, so all of it lands in one commit.** The render that
   * names the card is the one that mounts its panel; `toStage("parked")` locks
   * the page, takes the rest of the list off it and gives the `<main>` and the
   * list their parked boxes in the same phase — so the whole of the layout the
   * open costs happens here, before anything is painted, rather than in the
   * middle of a motion. What is left to animate is one transform.
   */
  useIsomorphicLayoutEffect(() => {
    if (active === null || stage.current === "parked") return;
    const from = flewFrom.current;
    flewFrom.current = null;

    stopFlight();
    toStage("parked");

    const card =
      listRef.current?.querySelector<HTMLElement>(
        `li[data-card="${CSS.escape(active)}"]`,
      ) ?? null;
    if (!card || from === null) return;

    flight.current = flyCard(card, from, card.getBoundingClientRect().top);
    landFlight();
  }, [active, listRef, stopFlight, toStage, landFlight]);

  /**
   * The return: un-park in one commit, and land the page **on the card**.
   *
   * **Nothing moves, which is the only way this direction can be smooth.** The
   * open can fly, because the whole of its layout is spent in the commit that
   * parks and the card then has the thread to itself. Closing is the opposite:
   * the page has to come *back*, and a hundred cards laid out and painted again
   * is 246ms in three bursts on the fixture — so a flight started into that
   * spends itself inside it. Driven, the card hung at its parked line for 333ms
   * and then travelled, which is a freeze followed by a slide.
   *
   * So the page is scrolled to wherever leaves the card at the line it is
   * already standing on, and the list simply grows back around it. The reader
   * ends on the card they were reading rather than on the row they pressed —
   * which is the same place, seen from the list rather than from the screen —
   * and there is no motion to stutter. Only a card too near the top of the
   * document for that scroll to be reachable moves at all, and then by less
   * than the park's own offset, which is what the flight is kept for.
   *
   * A layout effect, and the order inside the commit is the whole of it: the
   * card's parked line is read *before* `toStage("idle")` hands the `<main>`
   * and the list their own boxes back, and the page is landed before anything
   * is painted. Released outright the document is at scroll 0 with a hundred
   * cards above the one being read, and a passive effect would have painted it.
   */
  useIsomorphicLayoutEffect(() => {
    if (active !== null || stage.current === "idle") return;
    const leaving = leavingId.current;
    leavingId.current = null;
    stopFlight();

    const card =
      leaving === null
        ? null
        : (listRef.current?.querySelector<HTMLElement>(
            `li[data-card="${CSS.escape(leaving)}"]`,
          ) ?? null);
    // Read while the card is still parked — this is where the reader is looking.
    // Where the card was parked, read while it was still on the page — see the
    // collapse's own effect above.
    const from = flewFrom.current;
    flewFrom.current = null;

    toStage("idle");

    if (!card || !card.isConnected || from === null) return;
    const top = card.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, top - from), behavior: "auto" });
    // Whatever the document was too short to give, and nothing in the ordinary
    // case: `flyCard` answers null for a card that has not moved.
    flight.current = flyCard(card, from, card.getBoundingClientRect().top);
    landFlight();
  }, [active, listRef, stopFlight, toStage, landFlight]);

  /* ── Escape, and the teardown ────────────────────────────────────── */

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
      // Unmounting mid-open must not leave the document locked or the `<main>`
      // padded: the writes have exactly one owner and this is where it lets go.
      flight.current?.cancel();
      flight.current = null;
      unpark.current?.();
    },
    [],
  );

  return {
    active,
    parked: active !== null,
    closing,
    isOpen: (id) => active === id,
    isLit: (id) => active === id && !closing,
    toggle,
    close,
    shellProps: SHELL_PROPS,
    chromeClass: CHROME_CLASS,
  };
}
