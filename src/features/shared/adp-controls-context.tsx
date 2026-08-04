"use client";

import { createContext, useContext, useMemo, useState } from "react";

import { type AdpControls, defaultAdpControls } from "./adp-controls";

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
  const value = useMemo(
    () => ({
      controls,
      setControls,
      resetControls: () => setControls(defaultAdpControls(season)),
      defaultSeason: season,
    }),
    [controls, season],
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
