"use client";

import type { PlayerSummary } from "@/shared/players";

import { shortPlayerName } from "../../format";
import { pickLabel } from "../../pick-value";
import { groupRosterByPosition } from "../../roster-groups";
import type { RosterPlayer } from "../../roster-groups";
import type { TimelineRoster } from "../../timeline";
import { Avatar } from "../avatar";
import { positionTextTone } from "../position-badge";

/**
 * The league at one past moment, in the detail panel's own two-column shape:
 * the managers on the left, the selected one's roster on the right.
 *
 * **It is the panel's layout with the panel's numbers removed, which is the whole
 * of the design.** A reader who scrubs the rail has not changed what they are
 * looking at — the same league, the same two halves, the same selection driving
 * the right one from the left — only *which* players are on the roster. So the
 * grammar is carried over exactly: a recessed field (`.lab-trough`) for the half
 * being read, a raised plate (`.lab-plate-sm`) for the one being looked at, a lit
 * `.lab-row` key for the selected manager, a rank-style tab on the row's corner,
 * and the name/meta pair of lines the standings row already uses.
 *
 * **What is not carried over is every number, and that is not a gap.** Ranks,
 * records, points for, projections, KTC and ADP are all facts about the league
 * *today*: the panel's own columns are correct beside a current roster and would
 * be attributing today's numbers to a team that no longer exists beside a past
 * one. So the two things this view states are the two things a rewind actually
 * knows — who held which roster, and who was on it — and everything else is left
 * to the panel, which is one press of `Now` away.
 *
 * The one number that survives is the roster's **size**, which is knowable at any
 * moment and is what a reader is comparing across the league; it takes the seat
 * the record holds on a standings row.
 */
export function TimelineRosters({
  rosters,
  players,
  managers,
  selectedId,
  onSelect,
  caveat,
}: {
  /** The league at this stop, in draw order — see {@link timelineRosters}. */
  rosters: TimelineRoster[];
  players: Readonly<Record<string, PlayerSummary>>;
  /** User ids → who they are, for naming and picturing a roster's holder. */
  managers: Readonly<Record<string, TimelineManager>>;
  /** Which roster the right half is showing. */
  selectedId: number | null;
  onSelect: (rosterId: number) => void;
  /** The line under the halves saying which moment this is, and how it is known. */
  caveat: string;
}) {
  // A roster the league doesn't hold falls back to the head of the list, the
  // panel's own reading of a `focusRosterId` naming a team that has since been
  // replaced — and the same fallback covers the first render, before anything has
  // been selected at all.
  const selected =
    rosters.find((r) => r.roster_id === selectedId) ?? rosters[0] ?? null;

  if (!selected) {
    return (
      <p className="px-3 pb-3 pt-1 text-[11px] text-foreground/35 @lg:px-5 @lg:pb-5">
        No rosters stored for this league yet.
      </p>
    );
  }

  return (
    // The container is a **bare wrapper**, never the box that carries the padding
    // — an element is never its own query container, so `@container` and `@lg:p-*`
    // on one div is a rule that silently never applies. The panel keeps the same
    // split for the same reason, and it is what makes the tiers below measure this
    // view rather than the viewport.
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col pb-3 pl-3 pr-2 pt-2 @lg:pb-5 @lg:pl-5 @lg:pr-4 @lg:pt-3">
        {/* The panel's own split, down to the row template: two equal halves at
            every width, because reading one against the other is the point and
            neither is worth folding away on a phone. `grid-rows-[minmax(0,1fr)]`
            rather than a bare `1fr`, whose auto minimum is the taller half's full
            height — the row would refuse to be smaller than the list it is
            supposed to be scrolling. */}
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-1.5 @lg:gap-4">
          <TimelineTeams
            rosters={rosters}
            managers={managers}
            selectedId={selected.roster_id}
            onSelect={onSelect}
          />
          <TimelineRosterDetail
            roster={selected}
            rosters={rosters}
            players={players}
            managers={managers}
          />
        </div>

        {/* Outside both scroll boxes, where the panel keeps its own caveat: a note
            about how the numbers above it are known has to stay on screen with
            them. */}
        <p className="mt-2 shrink-0 text-[0.7rem] leading-relaxed text-foreground/40">
          {caveat}
        </p>
      </div>
    </div>
  );
}

/** As much of a manager as this view names one by. */
export type TimelineManager = {
  display_name: string | null;
  avatar_url: string | null;
};

/**
 * The managers, as the standings' own field: a recessed trough of lit keys, one
 * per roster, driving the half beside it.
 *
 * **The corner tab holds the roster number rather than a rank**, which is the one
 * substitution this half makes. A rank is against a field of records and
 * projections that only exist for today; a roster id is a fact at every moment,
 * it is stable as the rail moves, and it is what the roster's own picks are named
 * from a few pixels to the right ("2027 1st (roster 4)" where a holder has left).
 */
function TimelineTeams({
  rosters,
  managers,
  selectedId,
  onSelect,
}: {
  rosters: TimelineRoster[];
  managers: Readonly<Record<string, TimelineManager>>;
  selectedId: number;
  onSelect: (rosterId: number) => void;
}) {
  return (
    <div className="lab-trough flex min-h-0 flex-col rounded-lg p-1 @lg:p-2">
      <p className="shrink-0 truncate px-1 pb-2 pt-1 text-[0.6rem] uppercase tracking-wide text-foreground/50 @lg:px-3 @lg:text-xs">
        Manager
      </p>
      {/* The list is what scrolls. The bar rides in a lane of its own rather than
          over the rows' trailing edge — 8px of padding, half of it paid for by
          bleeding into the trough's own inset, which is the standings' own
          arrangement. */}
      <ul className="lab-scroll -mr-1 flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain pb-0.5 pr-2">
        {rosters.map((roster) => (
          <TimelineTeamRow
            key={roster.roster_id}
            roster={roster}
            manager={roster.user_id ? managers[roster.user_id] : undefined}
            active={roster.roster_id === selectedId}
            onSelect={() => onSelect(roster.roster_id)}
          />
        ))}
      </ul>
    </div>
  );
}

function TimelineTeamRow({
  roster,
  manager,
  active,
  onSelect,
}: {
  roster: TimelineRoster;
  manager: TimelineManager | undefined;
  active: boolean;
  onSelect: () => void;
}) {
  const name = manager?.display_name || `Roster ${roster.roster_id}`;
  // On the lit face a shade of the foreground token is a shade of the wrong
  // colour, so the dim cell switches to opacity — the standings row's own rule.
  const dim = active ? "opacity-70" : "text-foreground/40";

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        title={name}
        aria-current={active ? "true" : undefined}
        // A raised key rather than a tinted row: pressing it drives the roster
        // half beside it, and the selected one is the part that is currently on.
        // `relative` is what the corner tab is positioned against.
        className={`relative grid w-full grid-cols-[minmax(0,1fr)] items-center gap-y-0.5 rounded-md px-1 py-1.5 text-left @sm:px-1.5 @lg:px-3 @lg:py-2.5 ${
          active ? "lab-row-on" : "lab-row"
        }`}
      >
        <span
          className={`absolute left-0 top-0 inline-flex h-[17px] min-w-[26px] items-center justify-center rounded-br-md rounded-tl-md px-[5px] font-mono text-[9px] font-bold leading-none tracking-[0.04em] ${
            active ? "lab-tab-on text-foreground/90" : "lab-tab text-foreground/60"
          }`}
        >
          {roster.roster_id}
        </span>

        {/* Indented past the tab's overhang, which it gives up on this line
            alone — the standings row's own construction. */}
        <span className="flex min-w-0 items-center gap-1 pl-[22px] @lg:gap-2">
          <Avatar url={manager?.avatar_url ?? null} name={name} size="sm" />
          <span
            className={`min-w-0 truncate text-[0.8125rem] font-medium @lg:text-[0.9375rem] @2xl:text-base ${
              active ? "font-semibold" : "text-foreground/90"
            }`}
          >
            {name}
          </span>
        </span>

        {/* The seat the record holds on a standings row, carrying the one number
            a rewind actually knows. `in this trade` marks the sides rather than a
            tinted row or a badge: at this width a word is what fits, and it is
            the reason the sheet is open. */}
        <span className={`truncate text-[0.6rem] tabular-nums @sm:text-[0.7rem] @lg:text-xs ${dim}`}>
          {roster.players.length}{" "}
          {roster.players.length === 1 ? "player" : "players"}
          {roster.dealt && <span> · in this trade</span>}
        </span>
      </button>
    </li>
  );
}

/**
 * The selected manager's roster as it stood, on the panel's raised plate.
 *
 * **One list with a chip lane, not sections**, which is the panel's own roster row
 * and is what makes this read as the same half. The chip there is a *lineup slot*;
 * here it is the player's **position**, because a lineup is a solve — over
 * eligibility, projections and this league's slots — and none of those is a fact
 * about a past roster: the projections are rest-of-season from today, and Sleeper
 * stores no historical lineup at all. So the lane carries what is knowable, in the
 * same 26px tab washed by the same `positionTextTone`, and the colour scan down the
 * list survives unchanged.
 *
 * A first cut drew a captioned section per position. It is the ordering rosters
 * have been written in for thirty years and it was wrong *here*: a heading plus a
 * gap per position turned a twelve-man roster into five headings and eight rows,
 * so the column was mostly furniture. The chip says the same thing per row, in the
 * lane the panel already has for it.
 *
 * **The order is still by position** — {@link groupRosterByPosition}, flattened —
 * so the chips run in lineup order rather than alphabetically.
 *
 * **It names no team of its own**, the panel's rule at this grain: the half beside
 * it has the selected manager lit a few pixels to the left, and a plate repeating
 * the name would be the restatement that panel's own team plate was removed for.
 */
function TimelineRosterDetail({
  roster,
  rosters,
  players,
  managers,
}: {
  roster: TimelineRoster;
  /** Every roster, for naming the one an acquired pick came from. */
  rosters: TimelineRoster[];
  players: Readonly<Record<string, PlayerSummary>>;
  managers: Readonly<Record<string, TimelineManager>>;
}) {
  const lines = groupRosterByPosition(roster.players, players).flatMap((group) =>
    group.players.map((player) => ({ position: group.position, player })),
  );

  return (
    <div className="lab-plate lab-plate-sm flex min-h-0 flex-col rounded-lg p-1 @sm:p-1.5 @lg:p-4">
      <p className="shrink-0 truncate px-1 pb-1.5 text-[0.6rem] uppercase tracking-wide text-foreground/50 @lg:px-0 @lg:text-xs">
        Roster
      </p>

      <div className="lab-scroll -mr-1 min-h-0 overflow-y-auto overscroll-contain pr-2">
        {lines.length === 0 && roster.picks.length === 0 ? (
          // Stored *and* empty is a real answer — a pre-draft expansion team
          // genuinely held nobody — where an absent roster is not, which is why
          // a league with nothing stored draws no halves at all rather than a
          // column of these.
          <p className="px-1 py-2 text-[0.7rem] text-foreground/30">Held nothing</p>
        ) : (
          <ul className="flex flex-col">
            {lines.map(({ position, player }) => (
              <PlayerLine
                key={player.player_id}
                position={position}
                player={player}
              />
            ))}
          </ul>
        )}

        {roster.picks.length > 0 && (
          <div className="mt-3">
            {/* `h3`, not `h4`: the league's name is the `h2` above it in both
                hosts — the sheet's own header and the card's nameplate. The
                picks are the tail of this list rather than a section of it, which
                is where the panel puts its own. */}
            <h3 className="mb-1 truncate px-1 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-foreground/45 @lg:text-xs">
              Picks
            </h3>
            <ul className="flex flex-col">
              {roster.picks.map((pick) => {
                // The origin is named exactly when the pick did *not* come from
                // this roster, `pick-display`'s own rule: naming the holder
                // beside their own pick is noise on most of a portfolio. No
                // draft order here, so it is the round spelling — "2027 1st" —
                // which is the honest one for a pick seasons out anyway.
                const label = pickLabel(pick, null);
                const origin = rosters.find((r) => r.roster_id === pick.roster_id);
                const from = origin?.user_id ? managers[origin.user_id] : undefined;
                return (
                  <li
                    key={`${pick.season}-${pick.round}-${pick.roster_id}`}
                    className={`${ROW_BAND} px-1 py-1`}
                  >
                    <span className="min-w-0 truncate text-[0.8125rem] text-foreground/70">
                      {label}
                      {pick.roster_id !== roster.roster_id && (
                        <span className="text-foreground/35">
                          {" "}
                          from {from?.display_name || `roster ${pick.roster_id}`}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The band that parts two rows.
 *
 * The panel's own, and for its reason: a list this short-lined wants a tone rather
 * than forty hairlines of drawn furniture. `@max-3xl:` rather than an `odd:` turned
 * off later, since two variants of one property tie on specificity *and* source
 * order — the failure would be a banded one-line list, which looks deliberate and
 * is not. It bleeds 4px past the row's box to reach the plate's inset, and the
 * `px-1` at each call site puts the content back where it was.
 */
const ROW_BAND = "-mx-1 @max-3xl:odd:bg-foreground/[0.022]";

/**
 * One player: his position on a chip, then who he is and who he plays for.
 *
 * The panel's roster row, with the position in the lane its slot chip rides in.
 * Below `@3xl` the chip is out of flow on the row's leading corner — so it costs
 * the row nothing but the name's indent — and from `@3xl` it is the first cell of
 * the grid, which is the same switch the panel makes and at the same tier.
 *
 * The name is the only thing that truncates: a shortened name still reads as a
 * name, where `LAR` clipped to `LA` reads as a different team.
 */
function PlayerLine({
  position,
  player,
}: {
  position: string;
  player: RosterPlayer;
}) {
  const tone = positionTextTone(position);
  const short = shortPlayerName(player.name, position);

  return (
    <li
      className={`${ROW_BAND} relative grid grid-cols-[minmax(0,1fr)] items-center px-1 py-1 @3xl:grid-cols-[2.25rem_minmax(0,1fr)] @3xl:gap-x-2 @3xl:py-2`}
    >
      {/* `left-0` rather than a negative offset: the list is inside a scroll box,
          and `overflow-y: auto` computes `overflow-x` to `auto` too — so anything
          reaching past the box's leading edge is clipped rather than overhanging.
          The panel learned that one the hard way. */}
      <span
        className={`lab-tab lab-tab-pos absolute left-0 top-[2px] inline-flex h-[17px] min-w-[26px] items-center justify-center rounded-[5px] px-1 font-mono text-[9px] font-bold uppercase leading-none tracking-[0.04em] @3xl:static @3xl:top-auto @3xl:w-full ${tone}`}
      >
        {position}
      </span>

      <span
        title={player.name}
        className="flex min-w-0 items-baseline gap-1.5 pl-[34px] text-[0.8125rem] text-foreground/85 @3xl:pl-0 @4xl:text-sm"
      >
        {/* Contracted below `@lg` and whole above it, the panel's own treatment
            and its arithmetic: at this width the name track is roughly where real
            player names *start*, so `Bijan Robinson` truncates to `Bijan Robi…`
            where `B. Robinson` fits whole. A length threshold cannot express that
            — the two are 14 and 17 characters and the shorter one is the wider —
            so every name contracts and the column stays uniform, which is how a
            box score has been written for a century. Both spans are rendered
            rather than branched on, since most names differ between them; where
            they agree (a team defence, a name with no space) one is drawn. */}
        {short === player.name ? (
          <span className="min-w-0 truncate">{player.name}</span>
        ) : (
          <span className="min-w-0 truncate">
            <span className="@lg:hidden">{short}</span>
            <span className="hidden @lg:inline">{player.name}</span>
          </span>
        )}
        {player.team && (
          <span className="shrink-0 text-[0.7rem] text-foreground/35">
            {player.team}
          </span>
        )}
      </span>
    </li>
  );
}
