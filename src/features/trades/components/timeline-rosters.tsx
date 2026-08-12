"use client";

import { pickLabel } from "@/features/shared/pick-value";
import type { PlayerSummary } from "../types";

import { groupRosterByPosition } from "../roster-before";
import type { TimelineRoster } from "../timeline";

/**
 * Every roster in the league as it stood at one moment.
 *
 * **This is what the rail moves, and it is drawn instead of the detail panel
 * rather than inside it.** The panel's whole apparatus — the standings, the
 * projections, the optimal lineup, the KTC and ADP columns — is about the league
 * *now*: a rank is against today's field, a projection is for the rest of today's
 * season, and an optimal lineup is a solve over the roster the server was asked
 * about. Laying a past roster under those numbers would attribute all of them to
 * a team that no longer exists, which is the one thing this codebase keeps
 * refusing. So at "now" the sheet is exactly the panel it always was, and at any
 * earlier stop it is this: the players each team held, and nothing claimed about
 * them that cannot be known.
 *
 * **Every roster, not a selected one.** The panel needs a selector because its
 * right half is one team's detail; here each block is short enough that the whole
 * league fits a scroll, which answers "any roster at that point in time" without
 * a control to answer it *with* — and without a second team selection to keep in
 * step with the panel's own.
 *
 * The blocks are recessed (`.lab-trough`), which is the app's raised/recessed
 * grammar doing its job: there is nothing to act on here. Nothing in this view is
 * pressable, so nothing in it is raised.
 */
export function TimelineRosters({
  rosters,
  players,
  managers,
  caveat,
}: {
  /** The league at this stop, in draw order — see {@link timelineRosters}. */
  rosters: TimelineRoster[];
  players: Readonly<Record<string, PlayerSummary>>;
  /** User ids → display name, for naming a block. */
  managers: Readonly<Record<string, { display_name: string | null }>>;
  /** The line above the grid saying which moment this is. */
  caveat: string;
}) {
  // Roster id → who holds it, which is what names a *pick's origin* as well as a
  // block. Built once for the grid rather than per pick line, since a portfolio
  // names a handful of origins and there are a dozen blocks.
  const holders = new Map(rosters.map((r) => [r.roster_id, r.user_id]));

  return (
    // The scroll box is here rather than around this, for the reason the detail
    // panel's halves hold their own: what the sheet owes whatever it is showing is
    // a *bound*, and this view is a single list that scrolls under the rail.
    <div className="lab-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-2.5 sm:px-4">
      <p className="mb-2.5 text-[11px] leading-relaxed text-foreground/40">
        {caveat}
      </p>

      {rosters.length === 0 ? (
        <p className="text-[11px] text-foreground/35">
          No rosters stored for this league yet.
        </p>
      ) : (
        // Viewport tiers rather than container ones, which is the exception the
        // detail panel's rule allows: that panel is measured because it renders
        // at half a card's width inside a list, where this fills a dialog whose
        // own width *is* `min(1180px, 100vw - 1.5rem)` — so the viewport is the
        // container, one subtraction out.
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rosters.map((roster) => (
            <RosterBlock
              key={roster.roster_id}
              roster={roster}
              players={players}
              managers={managers}
              holders={holders}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One team's roster at this stop, grouped the way a roster is always written. */
function RosterBlock({
  roster,
  players,
  managers,
  holders,
}: {
  roster: TimelineRoster;
  players: Readonly<Record<string, PlayerSummary>>;
  managers: Readonly<Record<string, { display_name: string | null }>>;
  holders: ReadonlyMap<number, string | null>;
}) {
  const name =
    (roster.user_id ? managers[roster.user_id]?.display_name : null) ||
    `Roster ${roster.roster_id}`;
  const groups = groupRosterByPosition(roster.players, players);

  return (
    <div
      className={`lab-trough rounded-lg p-2.5 ${
        // The trade's own sides, marked so a reader can find them in a dozen
        // blocks. A lit edge rather than a badge: at this size a word costs a
        // line, and what the mark has to say is only "this one" — which a rail
        // down the leading edge says without spending any width at all.
        roster.dealt ? "border-l-2 border-l-active/50" : ""
      }`}
    >
      <p className="mb-1.5 flex items-baseline gap-1.5">
        <span className="min-w-0 flex-1 truncate font-display text-xs font-semibold text-foreground/75">
          {name}
        </span>
        {/* Answered before a single name is read: how deep was this team. */}
        <span className="lab-engraved-faint shrink-0 text-[10px] font-semibold tabular-nums text-foreground/45">
          {roster.players.length}
        </span>
      </p>

      {groups.length === 0 && roster.picks.length === 0 ? (
        // A stored *and* empty roster is a real answer — a pre-draft expansion
        // team genuinely held nobody — where an absent one is not, which is why
        // a league with nothing stored draws no blocks at all rather than a grid
        // of these.
        <p className="text-[11px] text-foreground/30">Held nothing</p>
      ) : (
        <div className="flex flex-col gap-y-1">
          {groups.map((group) => (
            <Line key={group.position} label={group.position}>
              {group.players.map((p) => p.name).join(", ")}
            </Line>
          ))}

          {roster.picks.length > 0 && (
            <Line label="Picks" dim>
              {roster.picks
                .map((pick) => {
                  // No draft order here: a held pick is usually seasons out, so
                  // the round spelling — "2027 1st" — is the honest one anyway.
                  const label = pickLabel(pick, null);
                  // The origin is named exactly when the pick did *not* come
                  // from this roster, `pick-display`'s own rule: naming the
                  // holder beside their own pick is noise on most of a portfolio.
                  if (pick.roster_id === roster.roster_id) return label;
                  const from = holders.get(pick.roster_id);
                  const who = from ? managers[from]?.display_name : null;
                  return `${label} (${who || `roster ${pick.roster_id}`})`;
                })
                .join(", ")}
            </Line>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One labelled run of a roster: the position cut into the face, the names beside
 * it on a fixed track so every group's names start at one x.
 */
function Line({
  label,
  dim = false,
  children,
}: {
  label: string;
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[2.1rem_minmax(0,1fr)] items-baseline gap-x-1.5">
      {/* Cut into the face rather than lit on it, the card's own finish for a
          label that repeats down a list — see `.lab-engraved`. */}
      <span className="lab-engraved-faint font-display text-[8px] font-bold uppercase tracking-[0.14em] text-foreground/40">
        {label}
      </span>
      <span
        className={`min-w-0 break-words text-[11px] leading-snug ${
          dim ? "text-foreground/45" : "text-foreground/60"
        }`}
      >
        {children}
      </span>
    </div>
  );
}
