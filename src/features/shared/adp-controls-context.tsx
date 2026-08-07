"use client";

import { createContext, useContext, useMemo, useState } from "react";

import type { ManagerLeague } from "@/shared/manager";

import { type AdpControls, defaultAdpControls } from "./adp-controls";
import { activeFilterCount } from "./league-filters";
import { type LeagueScope, resolveLeagueScope } from "./league-scope";
import { useAdpLeagues } from "./use-adp-leagues";

type AdpControlsValue = {
  controls: AdpControls;
  setControls: (controls: AdpControls) => void;
  /** Back to the default board — the current season, whole, no narrowing. */
  resetControls: () => void;
  /**
   * The season a board defaults to, which the drawer needs beyond the current
   * selection: it decides which relative presets can mean anything (only a
   * season containing today can have a "last 30 days") and it is what Reset
   * returns to.
   */
  defaultSeason: string;
  /**
   * The league rules' **answer**: which crawled leagues the board is narrowed
   * to, as the ids every read of it carries.
   *
   * It is resolved here rather than at each call site because there are four of
   * them — the board itself, the Players tab's column, the cards' team value and
   * the panel's two value columns — and they have to be narrowed *identically*
   * or the drawer says one thing while the numbers under it say another. That is
   * the whole reason the board reaches those routes at all.
   *
   * `{ kind: "all" }` while no rule is set, and while the league list is still
   * loading. The second is the important one: with nothing in hand the rules
   * would resolve to "no league matched", which is a real answer to a question
   * nobody asked — so a board that has not yet been narrowed reads as unnarrowed
   * rather than as empty.
   */
  scope: LeagueScope;
  /**
   * The leagues that scope was resolved over — the population the filters dialog
   * counts its options across.
   *
   * Empty unless something has asked for it (see {@link useAdpLeagues}); the
   * drawer asks whenever it is open, and this store asks whenever a rule is set.
   * Both name one query key, so the two gates cost one request.
   */
  leagues: readonly ManagerLeague[];
};

const AdpControlsContext = createContext<AdpControlsValue | null>(null);

/**
 * Holds the ADP drawer's selection for one page — every tool the board is
 * seated in reads and drives its own instance of this rather than sharing one
 * across the app, the way the manager tool's three tabs share theirs (see
 * `AdpControlsProvider`'s use in `app/manager/[searched]/layout.tsx`) and the
 * trades page mounts its own around `TradesHome`. Splitting it this way keeps
 * a board chosen on `/trades` from bleeding into the manager tool's, which
 * describes a different population every time anyway — the trades board is
 * the whole crawled market, the manager board is filtered the same way but
 * seeded from *this* manager's leagues.
 *
 * It holds a real selection from the start rather than a null a consumer has
 * to fill in: the season a board opens on is a server-side fact
 * (`getActiveSeason()`), so the page or layout mounting this passes it as a
 * prop, before any consumer renders.
 *
 * **It also resolves the league rules**, which is the one thing here that is not
 * simply state. The rules are a browser-side predicate engine and what the
 * routes take is their answer, so somebody has to run them — and it has to be
 * one somebody, or the four reads priced off this board would be narrowed four
 * ways. Doing it here also means the list they run over is fetched exactly when
 * a rule is set rather than on every page load.
 */
export function AdpControlsProvider({
  season,
  children,
}: {
  /** The season a board opens on — a server-resolved fact, not a client guess. */
  season: string;
  children: React.ReactNode;
}) {
  const [controls, setControls] = useState<AdpControls>(() => defaultAdpControls(season));

  // Whether the rules narrow anything at all. It is the gate on the fetch as
  // well as on the resolution: an unnarrowed board needs no league list, which
  // is what keeps the largest read on either page off a first paint.
  const narrowing = activeFilterCount(controls.leagueRules) > 0;
  const { leagues } = useAdpLeagues(controls.season, { enabled: narrowing });

  const scope = useMemo(
    () => resolveLeagueScope(leagues, controls.leagueRules, narrowing),
    [leagues, controls.leagueRules, narrowing],
  );

  const value = useMemo(
    () => ({
      controls,
      setControls,
      resetControls: () => setControls(defaultAdpControls(season)),
      defaultSeason: season,
      scope,
      leagues,
    }),
    [controls, season, scope, leagues],
  );
  return (
    <AdpControlsContext.Provider value={value}>{children}</AdpControlsContext.Provider>
  );
}

/** The shared ADP controls. Throws outside an `AdpControlsProvider`. */
export function useAdpControls(): AdpControlsValue {
  const value = useContext(AdpControlsContext);
  if (!value) {
    throw new Error("useAdpControls must be used within an AdpControlsProvider");
  }
  return value;
}
