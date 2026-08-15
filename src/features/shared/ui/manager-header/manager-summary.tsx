import type { UserInfo } from "@/shared/contract";

// The module rather than the barrel: this card is *in* `features/shared`, so
// reaching its own index would be a cycle.
import { Avatar } from "../avatar";
import { formatRecord } from "../../format";
import type { OverallRecord } from "../../record";

import { HeaderReadout } from "./header-readout.tsx";
import type { HeaderProgress } from "./manager-header.types.ts";
import { recordBarParts } from "./manager-header.utils.ts";

/**
 * Who is being looked at and how their season is going: the avatar, the name,
 * the record as digits and as shape, and the readout that stands beside them.
 *
 * The `pt` clears the plate's corner tabs rather than the row being pushed below
 * them: the avatar is the row's height either way, so the plate is exactly as
 * tall as it was with both pills on the name line. It is the tallest tab's own
 * height plus a hairline and nothing more, and it is one number at every width
 * because it has to clear the *stepper* spelling of the season tab — 22px of key
 * against 20px of bare digits — whether or not this page draws one. Branching on
 * that would make the plate two heights for one card.
 */
export function ManagerSummary({
  user,
  season,
  record,
  scope,
  leagueCount,
  countdown,
  refreshing,
  progress,
  padding,
}: {
  user: UserInfo;
  season: string;
  record: OverallRecord;
  scope: string | null;
  leagueCount: number;
  /** Whether the readout may run a clock — see {@link ManagerHeaderProps}. */
  countdown: boolean;
  /**
   * Threaded to the readout, which is where a refresh in flight is drawn: the
   * flask takes the slot the dial and the countdown share. Nothing on this row
   * reads them, which is why they pass straight through rather than being
   * unpacked here.
   */
  refreshing?: boolean;
  progress?: HeaderProgress | null;
  /** The seam under the row — see `bodyPadding`, which is what sizes it. */
  padding: string;
}) {
  const name = user.display_name || user.username;

  return (
    // `z-[1]` keeps the row above the face's own specular sweep. That sweep is
    // `.lab-slab-face::after`, which is generated as the face's last child, so
    // with everything on `auto` it paints last and lies *over* the content — the
    // one thing the plate's decoration has never done. One utility buys back the
    // original reading.
    //
    // The insets are the slab's wall arithmetic, for the reason `statePadding`
    // spells out: 21px from the leading edge and 17px from the trailing one is
    // what the bordered box gave, and the trailing 6px is now wall.
    <div
      className={`relative z-[1] flex items-center gap-3 pl-[21px] pr-[11px] pt-6 sm:gap-4 sm:pl-[25px] sm:pr-[15px] ${padding}`}
    >
      <Avatar url={user.avatar_url} name={name} size="lg" />

      <div className="min-w-0 flex-1">
        {/* The name has the line to itself now, so it truncates against the
            gauge rather than against two pills — which is what moving them
            to the corners was for. */}
        <h1 className="min-w-0 truncate font-display text-base font-semibold tracking-tight sm:text-xl">
          {name}
        </h1>
        <RecordLine record={record} scope={scope} leagueCount={leagueCount} />
        <RecordBar record={record} />
      </div>

      <HeaderReadout
        season={season}
        pct={record.pct}
        countdown={countdown}
        refreshing={refreshing}
        progress={progress}
      />
    </div>
  );
}

/**
 * The record, and — only where it isn't the whole list — what it was counted
 * over.
 *
 * A season that hasn't started still shows its `0-0`: the digits are a true
 * count of games played, so the guard against dressing preseason up as a season
 * of losses lives in the pct alone — null rather than zero, an em dash on the
 * dial, never `.000` — see {@link aggregateRecord}. Only "your filters left
 * nothing" keeps its own words, because a `0-0` counted over no records at all
 * would be quoting records that don't exist.
 *
 * `record.leagues` can be smaller than the list — Sleeper keeps a manager in
 * `league_users` after they stop holding a team — and a denominator that small
 * is only honest beside the number it divides. But it usually *isn't* smaller,
 * and "116 of 116 leagues" is a denominator restating its numerator on a line
 * that has to stay short. So the shortfall is stated and the agreement is not:
 * the rule holds exactly where it means something. The count itself is up in the
 * plate's right corner tab, where it is a fact about the account rather than
 * about this record.
 */
function RecordLine({
  record,
  scope,
  leagueCount,
}: {
  record: OverallRecord;
  scope: string | null;
  leagueCount: number;
}) {
  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[13px] leading-snug">
      {record.leagues === 0 ? (
        <span className="text-foreground/55">No records in these leagues</span>
      ) : (
        <span className="font-mono font-semibold tabular-nums">
          {formatRecord(record)}
        </span>
      )}
      {/* No separator before it: at phone width the line can wrap and a dot left
          hanging off the end of the first line reads as a typo. The colour does
          the same job on one line or two. */}
      {scope && <span className="text-active/60">{scope}</span>}
      {record.leagues > 0 && record.leagues < leagueCount && (
        <span className="text-foreground/40">
          from <span className="tabular-nums">{record.leagues}</span> of{" "}
          <span className="tabular-nums">{leagueCount}</span> league
          {leagueCount === 1 ? "" : "s"}
        </span>
      )}
    </p>
  );
}

/**
 * The same three numbers as proportion — where a .520 season and a .680 one are
 * told apart at a glance rather than by reading.
 *
 * An unplayed season keeps the empty rail rather than dropping it, so the plate
 * is the same height in September as in December: a card that pins itself under
 * the app bar can't change how much of the list it covers as the season turns
 * over.
 */
function RecordBar({ record }: { record: OverallRecord }) {
  return (
    // The digits in `RecordLine` are the accessible reading of this; the bar is
    // the same three numbers as shape.
    // Capped rather than full-bleed: on a wide card the same three numbers
    // stretched a metre across the plate, which reads as a progress bar for
    // something rather than a proportion between two counts.
    <div aria-hidden="true" className="mt-1.5 flex h-1 max-w-[420px] gap-0.5">
      {record.games === 0 ? (
        <span className="block flex-1 rounded-sm bg-foreground/[0.07]" />
      ) : (
        recordBarParts(record).map((part) => (
          <span
            key={part.key}
            className={`block rounded-sm ${part.tone}`}
            style={{ flexGrow: part.count }}
          />
        ))
      )}
    </div>
  );
}
