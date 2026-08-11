"use client";

import { Chevron } from "@/features/shared/ui/chevron";
import { pickLabel } from "@/features/shared/pick-value";
import type { TradeRosterPayload } from "@/shared/contract";

import { useTradeRosters } from "../../hooks/use-trade-rosters";
import { groupRosterByPosition } from "../../roster-before";
import type {
  PlayerSummary,
  Trade,
  TradeManager,
  TradeSide,
} from "../../types";
import { SIDE_SEAM_ROW, SIDE_ZONE } from "./trade-card.constants.ts";
import type { TradeCardLookups } from "./trade-card.types.ts";
import { sideSeam, sideSpansRow } from "./trade-card.utils.ts";

/**
 * What each side held immediately before the trade, behind a disclosure.
 *
 * **This is the half of a trade a card could never state.** The face above says
 * what moved; nothing on it says what the deal was made *out of*, and that is
 * most of what makes one legible — three receivers for a first reads one way off
 * a team that had eight and another off a team that had three. Sleeper publishes
 * no history, so the state is reconstructed by walking the league's later
 * transactions backwards from the current roster and stored per trade; see
 * `shared/trades/rewind` for the walk and its two limits.
 *
 * **Behind a press, and fetched on the press.** A pre-trade roster is 25–50
 * player ids per side plus the names for them, which on a page of two hundred
 * trades is several hundred KB for a disclosure most readers open on no card at
 * all. So it is its own route and its own query, the split-at-the-press habit the
 * ADP drawer and the columns editor already follow — and the reason the hook is
 * called one component down: `TradeCard` renders ~26 at a time, and a hook at
 * that level would fire for every windowed card.
 *
 * It is deliberately **not** a `dynamic()` chunk, which is where it parts company
 * with those two. What would be split is a list renderer and a `useQuery` over a
 * client already on the page — a few hundred bytes against a chunk boundary and a
 * placeholder to hold the row's height. The rule is to split what a reader might
 * never open *and* what costs something; this is only the first.
 */

/**
 * The disclosure itself: always drawn, so the card always says the reading is
 * available.
 *
 * **The button stops the press from reaching the card**, which is the one thing
 * that cannot be left out: the whole card is a press target that opens the
 * league sheet, so without this a reader asking for the rosters would get a
 * modal over the board instead. The card's nameplate is a real `<button>` for
 * the same collision, resolved the other way round.
 */
export function TradeRostersSection({
  trade,
  lookups,
  open,
  onToggle,
}: {
  trade: Trade;
  lookups: TradeCardLookups;
  open: boolean;
  /** Takes the trade rather than closing over it — see `TradeCardProps`. */
  onToggle: (trade: Trade) => void;
}) {
  const panelId = `trade-rosters-${trade.transaction_id}`;

  return (
    // A seam above it rather than a border box: this is another region of the
    // card's face, the same construction as the sides it sits under, and a box
    // here would be the plate the card deliberately stopped drawing. It is
    // `SIDE_SEAM_ROW` itself and not a second spelling of the same shadow —
    // the material has one definition, which is what that file is for.
    <div className={SIDE_SEAM_ROW}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={(event) => {
          // See the note above: the card underneath opens the league.
          event.stopPropagation();
          onToggle(trade);
        }}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-foreground/40 transition-colors hover:text-active"
      >
        <Chevron open={open} />
        <span>Rosters before this trade</span>
      </button>

      {open && (
        <div id={panelId}>
          <TradeRostersPanel trade={trade} lookups={lookups} />
        </div>
      )}
    </div>
  );
}

/**
 * The rosters themselves, mounted only while the disclosure is open — which is
 * what gates the fetch, the rule `useTradeFacets` states.
 */
function TradeRostersPanel({
  trade,
  lookups,
}: {
  trade: Trade;
  lookups: TradeCardLookups;
}) {
  const { data, loading, error } = useTradeRosters(trade.transaction_id);

  if (loading) return <PanelNote>Reading rosters…</PanelNote>;
  if (error) return <PanelNote alert>{error}</PanelNote>;

  const rosters = data?.rosters ?? [];
  if (rosters.length === 0) {
    // **Absent is "not known", never "held nothing".** The walk skips a trade
    // Sleeper filed with no timestamp, and a league the crawler has not visited
    // since the snapshots existed has none yet — so this says which it is rather
    // than drawing two empty rosters.
    return (
      <PanelNote>
        Not recorded for this trade. Snapshots are written as the league syncs,
        and a trade with no timestamp gets none at all.
      </PanelNote>
    );
  }

  return (
    // The sides' own grid, so a block lands under the side it belongs to —
    // `sideSeam` and `sideSpansRow` are shared with that grid for exactly this.
    <div className="grid pb-1 sm:grid-cols-2">
      {trade.sides.map((side, i) => (
        <RosterBlock
          key={side.roster_id}
          side={side}
          snapshot={rosters.find((r) => r.roster_id === side.roster_id) ?? null}
          players={data?.players ?? {}}
          managers={data?.managers ?? {}}
          lookups={lookups}
          seam={sideSeam(i)}
          wide={sideSpansRow(i, trade.sides.length)}
        />
      ))}
    </div>
  );
}

/** One side's roster as it stood, grouped by position. */
function RosterBlock({
  side,
  snapshot,
  players,
  managers,
  lookups,
  seam,
  wide,
}: {
  side: TradeSide;
  /** Null where this side has no snapshot stored — see the note where it is drawn. */
  snapshot: TradeRosterPayload | null;
  players: Record<string, PlayerSummary>;
  /**
   * The **payload's** managers, not the page's: a held pick can originate from a
   * roster in no trade on the board, so its owner is one the loaded pages never
   * named. The sides' own names still come off `lookups`, which is where a card
   * reads every other name.
   */
  managers: Record<string, TradeManager>;
  lookups: TradeCardLookups;
  seam: string;
  wide: boolean;
}) {
  // **The manager is named again here, and it is not the restatement the card
  // otherwise avoids.** Above `sm` these blocks sit under their own side and the
  // name is column-aligned a few lines up; below it everything stacks, so the
  // order is both sides' hauls and then both sides' rosters — at which point an
  // unlabelled block is a list of forty names belonging to nobody in particular.
  const manager = side.user_id ? lookups.managers[side.user_id] : undefined;
  const name = manager?.display_name || `Roster ${side.roster_id}`;

  const groups = snapshot ? groupRosterByPosition(snapshot.players, players) : [];
  const picks = snapshot?.picks ?? [];

  return (
    <div className={`${SIDE_ZONE} ${seam} ${wide ? "sm:col-span-2" : ""}`}>
      <p className="mb-1.5 flex items-baseline gap-1.5 text-[11px]">
        <span className="min-w-0 truncate font-semibold text-foreground/60">
          {name}
        </span>
        {snapshot && (
          // The count is what makes the block scannable without reading it —
          // "how deep were they" is answered before a single name is.
          <span className="shrink-0 tabular-nums text-foreground/30">
            {snapshot.players.length} players
          </span>
        )}
      </p>

      {!snapshot ? (
        // One side stored and the other not is possible — the walk skips a
        // roster it has no current state for, the house rule that a synthesised
        // empty roster is a claim worse than a gap.
        <p className="text-[11px] text-foreground/30">Not recorded</p>
      ) : groups.length === 0 && picks.length === 0 ? (
        // Stored *and* empty is a real answer, unlike an absent snapshot: a
        // pre-draft roster in an expansion league genuinely held nobody.
        <p className="text-[11px] text-foreground/30">Held nothing</p>
      ) : (
        <div className="flex flex-col gap-y-1">
          {groups.map((group) => (
            <div
              key={group.position}
              className="grid grid-cols-[2.1rem_minmax(0,1fr)] items-baseline gap-x-1.5"
            >
              {/* Cut into the face rather than lit on it, the card's own finish
                  for a label that repeats down a list — see `.lab-engraved`. A
                  fixed track so every group's names start at one x. */}
              <span className="lab-engraved-faint font-display text-[8px] font-bold uppercase tracking-[0.14em] text-foreground/40">
                {group.position}
              </span>
              <span className="min-w-0 break-words text-[11px] leading-snug text-foreground/55">
                {group.players.map((p) => p.name).join(", ")}
              </span>
            </div>
          ))}

          {picks.length > 0 && (
            <div className="grid grid-cols-[2.1rem_minmax(0,1fr)] items-baseline gap-x-1.5">
              <span className="lab-engraved-faint font-display text-[8px] font-bold uppercase tracking-[0.14em] text-foreground/40">
                Picks
              </span>
              <span className="min-w-0 break-words text-[11px] leading-snug text-foreground/45">
                {picks
                  .map((pick) => {
                    // Null slot: the route sends no draft order for a held pick,
                    // so this is the round spelling — "2027 1st" — which is the
                    // honest one for a pick seasons out anyway.
                    const label = pickLabel(pick, null);
                    // The origin is drawn exactly when the pick did *not* come
                    // from this roster, `pick-display`'s own rule: naming the
                    // holder beside their own pick is a line of noise on most of
                    // a portfolio.
                    if (pick.roster_id === side.roster_id) return label;
                    const from = pick.user_id
                      ? managers[pick.user_id]?.display_name
                      : null;
                    return `${label} (${from || `roster ${pick.roster_id}`})`;
                  })
                  .join(", ")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PanelNote({
  children,
  alert = false,
}: {
  children: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <p
      // A failed read is worth interrupting for; "not recorded yet" is an answer
      // and not an error, the same split `TradesHome`'s own note draws.
      role={alert ? "alert" : undefined}
      className={`px-3 pb-2.5 text-[11px] ${
        alert ? "text-red-300/80" : "text-foreground/35"
      }`}
    >
      {children}
    </p>
  );
}
