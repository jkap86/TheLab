"use client";

import { leagueSpecs } from "@/features/shared/league-specs";
import { CardLedge, LeagueCard as Card } from "@/features/shared/ui/league-card";
import { LeagueSpecsBezel } from "@/features/shared/ui/league-specs";

import { formatRecord, ordinal } from "../format";
import { LEAGUE_METRICS, type MetricContext } from "../league-metrics";
import type {
  LeagueAdpEntry,
  LeagueKtcEntry,
  LeagueRank,
  LeagueRankSet,
  ManagerLeague,
} from "../types";
import { MetricColumns } from "./metric-column";

/**
 * One of this manager's leagues in the leagues list.
 *
 * **The card itself is `features/shared/ui/league-card`** — the slab, the two
 * plates on its top edge, the head's inset and the whole opening gesture — since
 * the lineup checker draws the same card over the same leagues. What is left here
 * is the two things that are *this* list's: the four ranking columns across the
 * head, and what rides on the trailing plate.
 *
 * That plate is {@link RecordLedge}: the manager's record and where it places
 * them, which is what this list is about. The lineup checker puts this week's
 * opponent in the same seat, which is most of the difference between the two
 * lists' cards.
 *
 * Neither card carries a caret any more — what says one opens is the slab lifting
 * and the face swapping to the panel's plate, and what says it *is* open to a
 * reader who cannot see either is the `aria-expanded` on the league's name.
 *
 * **A line leading the head names the league's settings**, as the same bezel of
 * gauges the trade cards wear (`ui/league-specs`) — type, size, the QB and
 * superflex slots, tight ends, TE premium and best ball. It is the trades board's
 * part for a reason that turns out to be this list's too: an account here is a
 * hundred leagues most of which differ in exactly those six ways, and the only
 * thing that answered "which of these is my superflex dynasty" was the filter
 * dialog — which *narrows* a list rather than describing a row of it, so a reader
 * had to take the answer on trust once the dialog closed. The run is derived by
 * the same predicates the dialog selects on, so a card and a filter cannot come to
 * different conclusions about one league.
 *
 * Where the line goes and what it costs is the shell's ({@link Card}, and it was
 * measured rather than guessed); what is decided here is only whether there is
 * one, which is the same call {@link RecordLedge} makes about its own plate.
 *
 * The four stat columns are each a slot the reader points at a metric — where
 * this manager stands by points, by KTC starter value and by projected points to
 * start with, but swappable to the raw number behind a rank or to KTC bench
 * value. Which metric each slot shows is held above this card, in
 * {@link ManagerLeagues}, so every card shows the same four and the columns line
 * up column to column down the whole list — and the control that moves them is
 * the heading rail up there too, which is why this card renders numbers and no
 * pickers of its own.
 */
export function LeagueCard({
  league,
  ranks,
  weeks,
  ktc,
  valuedAt,
  adp,
  columns,
  expanded,
  onToggle,
}: {
  league: ManagerLeague;
  /**
   * Where this manager sits by record, points for and projected points — null
   * while the ranks are loading, and each field independently null for a ranking
   * this league can't form yet (nothing projected, or nothing played). A missing
   * rank shows as a dim placeholder rather than a gap, so the columns stay put.
   */
  ranks: LeagueRankSet | null;
  /** The horizon behind the projected rank, so its hover can say what it covers. */
  weeks: number[];
  /**
   * This manager's KTC value here and its starter-value rank — null while
   * loading, and for a league they hold no roster in. Absent rather than zeroed,
   * on the same terms as `ranks`.
   */
  ktc: LeagueKtcEntry | null;
  /** When those KTC values were scraped, for the KTC metrics' hover. */
  valuedAt: string | null;
  /**
   * This manager's ADP-derived value here and its starter-value rank — null while
   * loading and for a league they hold no roster in, absent rather than zeroed on
   * the same terms as `ktc`.
   */
  adp: LeagueAdpEntry | null;
  /** The metric key each of the four stat columns shows, shared by every card. */
  columns: string[];
  /** Whether this is the league currently open — one at a time, list-wide. */
  expanded: boolean;
  /** Open this league, or close it if it is the one already open. */
  onToggle: () => void;
}) {
  const ctx: MetricContext = { league, ranks, ktc, adp, weeks, valuedAt };
  // Derived here rather than inside the bezel, because the *line* it sits on is
  // the card's and an empty one is still 12px of padding — the same split the
  // record ledge draws, and the same one the trade card's header line makes.
  const specs = leagueSpecs(league);

  return (
    <Card
      leagueId={league.league_id}
      name={league.name}
      status={league.status}
      ledge={<RecordLedge record={league.record} standing={ranks?.standing ?? null} />}
      specs={specs.length > 0 ? <LeagueSpecsBezel specs={specs} /> : undefined}
      columns={<MetricColumns metrics={LEAGUE_METRICS} ctx={ctx} columns={columns} />}
      expanded={expanded}
      onToggle={onToggle}
    />
  );
}

/**
 * The manager's record here, and where that record places them — on the plate
 * holding the card's trailing corner, opposite the name.
 *
 * **It is the same plate as the nameplate and it is not a second name**, which
 * is the whole of what its construction is for. Both facts sat in the head, in
 * front of the stat columns, which is the one part of the card that has to stay
 * quiet: the columns are what a list a hundred rows long is scanned on, and two
 * numbers ahead of them were being read as a fifth. On the edge they are what
 * they are — the card's two corners holding its two identities, which league this
 * is and how it is going.
 *
 * What keeps it from reading as a second label is the material rather than the
 * size. The record keeps the `.lab-readout` cut it already wore in the head, so
 * the move costs a reader nothing to relearn, and a cut into the plate's lit
 * face is machining: the plate is a *housing* around an instrument rather than a
 * plate with a name on it. The standing beside it is engraved — the finish the
 * trade card's values take, and for the same arithmetic, since there is one of
 * these per card all the way down the list and a numeral in the accent at that
 * count is wallpaper. Neither part is a chip: nothing here is pressed, and the
 * press that opens this card is the name on the other plate and the head under
 * both.
 *
 * **The standing is the rank alone.** `2nd` rather than `2nd of 12` — the
 * denominator is what a stat column's rank cell spends its width on, and here it
 * would come straight out of the league name's own truncation budget for a fact
 * the four columns beside it state four times. It survives where it costs
 * nothing: on the hover, and for a screen reader, where a bare ordinal is a rank
 * out of nothing.
 *
 * Two rules carry over from the head unchanged, and they are the card's own.
 * The standing rides *with* the record rather than occupying one of the four
 * stat slots, because it is what the record means in its league — reading it
 * anywhere else is reading half the fact, which is why it is not in the metric
 * catalogue. And **absent is not zero**: a league with no record renders no
 * plate rather than an empty housing, and a preseason league renders the record
 * without a standing, since `0-0` is a true count where a rank there would place
 * a season nobody has played.
 */
function RecordLedge({
  record,
  standing,
}: {
  record: ManagerLeague["record"];
  /** Where this manager places by record — null before a game is played. */
  standing: LeagueRank | null;
}) {
  // No housing rather than an empty one: a league this manager holds no roster
  // in has neither fact, and a plate there would be the card reporting that it
  // has nothing to report. The lineup checker's ledge parts company here and
  // says why — there, "nothing to report" is itself an answer worth printing.
  if (!record && !standing) return null;
  return (
    <CardLedge>
      {record && (
        <span className="lab-readout rounded px-1.5 py-px text-[12.5px] font-semibold leading-4 tabular-nums text-foreground/85">
          {formatRecord(record)}
        </span>
      )}
      {standing && (
        <span
          title={`#${standing.rank} of ${standing.of} by record`}
          className="lab-engraved shrink-0 text-[11px] font-semibold leading-4 tabular-nums text-foreground/80"
        >
          {ordinal(standing.rank)}
          {/* The denominator the ordinal is out of. Dropped from the plate
              because the width belongs to the league's name, kept here because
              "2nd" with nothing to be 2nd of is a rank a reader can't place —
              and this is the one reading of the card that has no hover. */}
          <span className="sr-only"> of {standing.of} by record</span>
        </span>
      )}
    </CardLedge>
  );
}
