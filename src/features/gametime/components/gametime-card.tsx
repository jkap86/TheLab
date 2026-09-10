"use client";

import { memo, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import type { GametimeGame, GametimeLeague, GametimeSide, ManagerLeague } from "@/shared/contract";
import {
  BubblingFlask,
  CardBilletRow,
  CardRule,
  CONSOLE_CARD_SHELL,
  CONSOLE_GLASS,
  CONSOLE_METAL,
  ExpandedPanel,
  LeagueBillet,
  LeagueConfigWindow,
  rankColor,
  Scanlines,
  sharePercentile,
  StandingBay,
  StandingStrip,
} from "@/features/shared";

import { playersInPlay } from "../helpers/live-record";
import { matchupGauge } from "../helpers/matchup-gauge";
import { LivePanes } from "./live-panes";

/**
 * One league's week, live, as an instrument housing.
 *
 * `LineupCheckCard` with the week's *result* in its window where that card puts
 * its four checks, and deliberately the same object everywhere else: the same
 * housing, the same billet with the avatar lit in its bezel and the same
 * settings strip under it — a reader walking from the checker to here is
 * looking at the same league, and the numbers changing is the whole of what
 * should differ. Every constraint that card records — the clip in one
 * decorative layer, `flex-1` in a flex `<li>`, the named `group/card`, the
 * `pointer-fine:` budget, `min-w-0` — is inherited and is silent when broken;
 * its module note carries the arguments.
 *
 * **One facing window: your live projection against your opponent's, with what
 * each has scored so far under it.** It replaced a standing strip of signed
 * margins and W/L chips over three tiles (`Score`, `Live proj`, `In play`), and
 * the argument for the swap is that a matchup has two sides: two figures facing
 * each other say which way the week is going without a reader having to read a
 * sign, and the pair of bars beneath them says how much of it has been played.
 * `In play` came off the card with those tiles and has since come back as a
 * **stamped reading on the rule's row** rather than a tile: what a reader
 * wanted from it was never a fourth window but how many of *their* players are
 * on the field, which is a figure about the week and belongs on the face. The
 * header gauge still counts the leagues, and it counts them by the same
 * figure — see `leaguesInPlay`.
 *
 * Hook-free, for `LineupCheckCard`'s reason, and `memo`'d for its reason: a
 * frame arrives every twenty seconds while a game runs, and every prop but
 * `entry`, `open` and `lit` is stable by construction — `board` included, and
 * see its own note for what that cost to arrange.
 */
export const GametimeCard = memo(function GametimeCard({
  league,
  entry,
  board,
  pending = false,
  live = false,
  open,
  lit,
  onToggle,
}: {
  league: ManagerLeague;
  /** This league's week, once the read lands. Undefined while it is in flight. */
  entry?: GametimeLeague | null;
  /**
   * The week's scoreboard by NFL team, read by the seat rows in the expanded
   * half — and **handed over only while this card is open**, because it is a
   * new object on every frame the room pushes and nothing on a shut card reads
   * it. A closed card takes a stable empty one instead, which is what keeps
   * the memo below holding through a live Sunday; see `gametime-home`.
   */
  board: Readonly<Record<string, GametimeGame>>;
  /** The page's read has not answered yet — see `LineupCheckCard`'s own prop. */
  pending?: boolean;
  /**
   * Whether the page is genuinely watching a live week — `gametimeReadout`'s
   * own `pulse`, lifted to the page so this and the readout beside the stepper
   * cannot come to disagree about it.
   *
   * It decides the in-play lamp's pulse and nothing else. A stream that has
   * gone stale, dropped or fallen back to a snapshot freezes every figure on
   * this card, and a lamp that went on pulsing over frozen numbers would be a
   * hundred cards claiming to be watching something under one readout saying
   * the page is not. It flips a handful of times a Sunday — a first kickoff, a
   * last whistle, a dropped socket — where `entry` moves every twenty seconds,
   * so the memo it costs is nothing beside the one it protects.
   */
  live?: boolean;
  open: boolean;
  lit: boolean;
  onToggle: (id: string, event: MouseEvent<HTMLElement>) => void;
}) {
  const mine = entry?.mine ?? null;
  const theirs = entry?.opponent ?? null;
  // An opponent is what makes this a matchup, so the median rides on one too:
  // a league's middle stated beside a side with nothing to face is a reading of
  // a week nobody has been scheduled for. `LiveStrip`'s own rule, kept.
  const median = theirs ? (entry?.median ?? null) : null;
  const reading = pending && !entry;
  // Null is the whole zero state — nothing in play, no answer yet, no league
  // — and it draws nothing. See the helper for why that is not a `0`.
  const inPlay = playersInPlay(entry);

  return (
    <li
      data-card={league.league_id}
      className="relative flex pointer-fine:[perspective:2400px] hover:z-10 has-[details[open]]:z-10"
    >
      <details
        open={open}
        data-lit={lit ? "" : undefined}
        className={`group/card ${CONSOLE_METAL} flex min-w-0 flex-1 flex-col`}
      >
        <summary
          onClick={(event) => onToggle(league.league_id, event)}
          className={
            // `z-10` keeps the decorative layer under this header: a
            // `<details>` paints its `<summary>` from a UA slot that comes
            // before the slot holding its other children, so the span written
            // first above would otherwise paint over the billet — the manager
            // card's own finding, and its own note carries the argument.
            `lab-card-3d ${CONSOLE_CARD_SHELL} relative z-10 pb-4 pt-[1.875rem] sm:pb-[1.125rem] sm:pt-[2.125rem] group-open/card:pb-0 flex flex-1 group-open/card:flex-none cursor-pointer list-none flex-col font-mono ` +
            "px-3.5 sm:px-[1.125rem] " +
            "pointer-fine:[transform-style:preserve-3d] [transform-origin:center_bottom] " +
            "pointer-fine:[transform:translateZ(0)_rotateX(3deg)] " +
            "pointer-fine:hover:[transform:translateZ(30px)_rotateX(0deg)] " +
            "pointer-fine:group-data-[lit]/card:[transform:translateZ(20px)_rotateX(0deg)] " +
            "transition-[transform,box-shadow,border-color] duration-[450ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] " +
            "hover:border-active/45 group-data-[lit]/card:border-active/45 " +
            "pointer-fine:hover:shadow-[var(--housing-shadow),var(--card-lift-hover),var(--card-halo-hover)] " +
            "pointer-fine:group-data-[lit]/card:shadow-[var(--housing-shadow),var(--card-lift-hover),var(--card-halo-hover)] " +
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
          }
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
          >
            <span className="lab-anim absolute inset-y-0 left-0 hidden w-[55%] -translate-x-[180%] -skew-x-12 bg-[image:var(--card-sheen)] transition-transform duration-[900ms] ease-out group-hover/card:translate-x-[450%] pointer-fine:block" />
            <span className="absolute -inset-x-1/4 -bottom-[8%] hidden h-[62%] origin-bottom bg-[image:var(--card-floor)] opacity-40 transition-opacity duration-[450ms] [mask-image:linear-gradient(to_top,#000,transparent_72%)] [transform:perspective(320px)_rotateX(66deg)] group-hover/card:opacity-100 group-data-[lit]/card:opacity-100 pointer-fine:block" />
            <span className="absolute -bottom-[45%] left-1/2 h-[85%] w-[120%] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--accent-glow),transparent_75%)] opacity-30 transition-opacity duration-[450ms] group-hover/card:opacity-80 group-data-[lit]/card:opacity-80" />
            <span className="absolute inset-x-[18%] top-0 h-px bg-[image:var(--card-edge-light)] opacity-0 transition-opacity duration-[450ms] group-hover/card:opacity-100 group-data-[lit]/card:opacity-100" />
          </span>

          <CardBilletRow>
            <LeagueBillet name={league.name} avatarUrl={league.avatar_url} />
          </CardBilletRow>

          {/* **The row carries `preserve-3d` and no transform of its own, and
              each child names its own plane** — the trade card's own finding,
              one card over. A plain wrapper is a flat rendering context, so a
              `translateZ` written here would collapse `CardRule`'s own 36px
              into it and the hairline would sit at the reading's depth, with
              no error to say so. The rule keeps the plane it has alone; the
              reading takes 20px, between the settings strip's 18 and the
              matchup window's 22.

              Closed over, the row is the single child the rule has always
              been: `items-center` on a row holding one 1px hairline is a
              no-op, so nothing about the card moves in the state where nothing
              is in play. */}
          <div className="relative flex items-center gap-3 pointer-fine:[transform-style:preserve-3d]">
            <CardRule />
            {inPlay && <InPlayReading reading={inPlay} pulse={live} />}
          </div>

          {/* The settings strip has the row to itself, so `LeagueConfigWindow`
              is *not* told it is `shared` — the standing that used to stand
              beside it is gone and the non-wrapping arm has the full width. */}
          <LeagueConfigWindow
            league={league}
            className="mt-3 sm:mt-3.5 pointer-fine:[transform:translateZ(18px)]"
          />

          {/* A lineup graded off the roster's *live* starters rather than the
              week's own stored ones has to say so. It keeps its place between
              the settings and the matchup, which is where it qualifies both. */}
          {entry?.as_of === "current" && (
            <p className="relative mt-3 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/85 pointer-fine:[transform:translateZ(14px)]">
              Lineup as set now
            </p>
          )}

          {/* A direct child of the summary, so the `translateZ` survives — a
              plain wrapper is a flat rendering context and every plane under it
              collapses with no error to say so. */}
          {reading ? (
            <MatchupWindow>
              <div className="relative flex items-center justify-center py-6 sm:py-7">
                <BubblingFlask size={34} label="Reading" />
              </div>
            </MatchupWindow>
          ) : (
            mine &&
            theirs && (
              <MatchupWindow>
                <Matchup mine={mine} theirs={theirs} median={median} />
              </MatchupWindow>
            )
          )}

          {mine && median && <MedianStrip mine={mine} median={median} />}
        </summary>

        {/* No sync key on the panel's seam, where the checker card carries
            one: this page is a stream, so a press re-reading Sleeper by hand
            is a control for a page that reads once. */}
        <ExpandedPanel open={open} closing={open && !lit}>
          {entry ? (
            <LivePanes
              mine={entry.mine}
              opponent={entry.opponent}
              board={board}
              teamName={league.team_name}
            />
          ) : (
            <p className="m-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-readout-label">
              No lineup read for this league this week
            </p>
          )}

          {entry && entry.unknown_slots.length > 0 && (
            <p className="m-0 shrink-0 pt-2.5 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-readout-label">
              Not shown: {entry.unknown_slots.join(", ")}
            </p>
          )}
        </ExpandedPanel>
      </details>
    </li>
  );
});

/**
 * How many of this league's players are on the field, stamped into the card's
 * own metal face on the rule's row.
 *
 * **A reading, not a part.** It was first drawn as a small billet hung in
 * `CardBilletRow` opposite the league's name, on `OwnerBillet`'s construction,
 * and rejected twice over: what it says is a figure about the week rather than
 * something the card *carries*, and a second billet in that overhang competes
 * with the league's name for width at a phone's, which is the one thing the
 * billet row was arranged to stop. Stamped on the face it costs the card the
 * rule row's own ~18px and moves no other measurement on it.
 *
 * **No denominator.** An earlier pass read `4/9`; the starter count is stated
 * one row down on the settings strip (`Starters 9`), and in a best-ball league
 * it is the wrong denominator anyway — Sleeper has not seated that lineup yet,
 * which is the same reason the count behind this is taken over the whole
 * roster there. The bare figure is the reading.
 *
 * **Only the reader's own side is lit.** Their figure takes `--billet-accent`
 * with the accent's halo and the opponent's takes `--billet-scope`, which is
 * the ink the `Opp` role label in the matchup window below already wears — so
 * the two columns cannot come to read as two of yours. Both are the billet's
 * ink family rather than an alpha over `--foreground`: those tokens are solid,
 * measured values in the light scheme, where an alpha over the foreground is a
 * washed near-black that inverts by accident rather than by design.
 *
 * **Everything visible is `aria-hidden` and the `sr-only` sentence is the whole
 * announcement.** A lamp, a legend and two bare numerals read out in order are
 * `In play 4 3`, which is not a reading; the sentence says it once, in words.
 * It is `position: absolute`, so it takes no share of the row's `gap-2`.
 *
 * **Not interactive**, like the standing strip: the card's own press covers the
 * whole summary and this adds no control and swallows nothing.
 */
function InPlayReading({
  reading,
  pulse,
}: {
  /** The two figures — `theirs` null where there is no opponent to have any. */
  reading: { mine: number; theirs: number | null };
  /** The page is genuinely watching a live week — see the card's own prop. */
  pulse: boolean;
}) {
  const figure =
    "whitespace-nowrap font-display text-[length:var(--fs-16)] font-semibold leading-[1.1] " +
    "tracking-[-0.015em] tabular-nums";

  return (
    <span className="relative ml-auto inline-flex shrink-0 items-center gap-2 pointer-fine:[transform:translateZ(20px)]">
      {/* The format bay's `Lamp`, to the value. It pulses **only while the
          page is live**, which is `gametimeReadout`'s own rule and the reason
          that reading is lifted to the page: over a stale or dropped stream
          every figure on this card is frozen, and a lamp still pulsing on top
          of them would be a hundred cards claiming to watch something the
          readout beside the stepper says the page is not. Slower than that
          readout's own 2s, deliberately — a page of lamps beating in time with
          the header reads as one blinking mass. */}
      <span
        aria-hidden
        className={`block h-[0.3125rem] w-[0.3125rem] shrink-0 rounded-full bg-active shadow-[0_0_6px_var(--accent-glow)] ${
          pulse ? "lab-anim animate-pulse [animation-duration:2.4s]" : ""
        }`}
      />
      <span
        aria-hidden
        className="whitespace-nowrap font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)]"
      >
        In play
      </span>
      <span
        aria-hidden
        className={`${figure} text-[color:var(--billet-accent)] [text-shadow:var(--standing-engrave),0_0_12px_var(--accent-glow)]`}
      >
        {reading.mine}
      </span>
      {reading.theirs !== null && (
        <>
          {/* The milled channel between two readings — the cut, not a rule. */}
          <span
            aria-hidden
            className="h-3.5 w-px shrink-0 bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
          />
          <span
            aria-hidden
            className={`${figure} text-[color:var(--billet-scope)] [text-shadow:var(--standing-engrave)]`}
          >
            {reading.theirs}
          </span>
        </>
      )}
      <span className="sr-only">
        {reading.mine} of your players in play
        {reading.theirs !== null && `, ${reading.theirs} of your opponent's`}
      </span>
    </span>
  );
}

/**
 * The lit glass the matchup is read on.
 *
 * **No machined header**, where every other window on these cards has one: the
 * two side labels sit on the glass because they name the *columns* rather than
 * the part, and a ledge across the top would be a third thing to read above two
 * figures that are the whole point.
 */
function MatchupWindow({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${CONSOLE_GLASS} mt-2.5 rounded-[0.625rem] sm:rounded-xl pointer-fine:[transform:translateZ(22px)]`}
    >
      <Scanlines />
      {children}
    </div>
  );
}

/**
 * The two readings facing each other, and the gauge under them.
 *
 * **The facing arrangement is kept at every width and nothing stacks**, which
 * is the one thing about this part that a phone would ordinarily undo: stacked,
 * the two figures stop being a comparison and become two readings that happen
 * to be adjacent. What gives instead is the team names, which truncate.
 */
function Matchup({
  mine,
  theirs,
  median,
}: {
  mine: GametimeSide;
  theirs: GametimeSide;
  median: { scored: number; live: number } | null;
}) {
  const gauge = matchupGauge(mine, theirs, median);
  const pair = [mine.live, theirs.live];

  return (
    <>
      <div className="relative grid grid-cols-[1fr_auto_1fr] items-end gap-2.5 px-3 pb-3 pt-3.5 sm:gap-[18px] sm:px-4 sm:pb-2.5">
        <MatchupSide
          role="You"
          roleClass="text-[color:var(--billet-accent)]"
          name={mine.team_name}
          side={mine}
          percentile={sharePercentile(mine.live, pair)}
          sentence={`You: on course for ${mine.live.toFixed(1)}, ${mine.scored.toFixed(1)} scored so far`}
        />

        <span className="self-center font-mono text-[length:var(--fs-9)] uppercase tracking-[0.18em] text-readout-muted sm:text-[length:var(--fs-10)]">
          vs
        </span>

        <MatchupSide
          mirrored
          role="Opp"
          // Only the reader's own side is lit — the opponent's role label takes
          // the billet's quiet ink, which is what keeps the two columns from
          // reading as two of yours.
          roleClass="text-[color:var(--billet-scope)]"
          name={theirs.team_name}
          side={theirs}
          percentile={sharePercentile(theirs.live, pair)}
          sentence={`${theirs.team_name ?? "Your opponent"}: on course for ${theirs.live.toFixed(1)}, ${theirs.scored.toFixed(1)} scored so far`}
        />
      </div>

      {/* One gauge opening outward from the centre: the left bar grows from the
          right edge inward and the right one from the left, so the two meet at
          the gutter and the lead is the gap between them. */}
      <div
        aria-hidden
        className="relative grid grid-cols-[1fr_12px_1fr] items-center px-3 pb-4 pt-2 sm:grid-cols-[1fr_14px_1fr] sm:px-4 sm:pb-[18px] sm:pt-2.5"
      >
        <GaugeBar mine reading={gauge.mine} median={gauge.median} />
        <span />
        <GaugeBar reading={gauge.theirs} median={gauge.median} />
      </div>
    </>
  );
}

/** One column of the matchup: who, what they are on course for, what they have. */
function MatchupSide({
  role,
  roleClass,
  name,
  side,
  percentile,
  sentence,
  mirrored = false,
}: {
  role: string;
  roleClass: string;
  /** The team's label, or null where none is stored — never invented. */
  name: string | null;
  side: GametimeSide;
  percentile: number;
  sentence: string;
  /** The opponent's column reads inward: name before role, `Now` before the figure. */
  mirrored?: boolean;
}) {
  const roleLabel = (
    <span
      className={`shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] sm:text-[length:var(--fs-10)] ${roleClass}`}
    >
      {role}
    </span>
  );
  const teamName = name ? (
    <span
      title={name}
      className="min-w-0 truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.1em] text-readout-label sm:text-[length:var(--fs-10)] sm:tracking-[0.12em]"
    >
      {name}
    </span>
  ) : null;

  const now = (
    <span className="flex shrink-0 items-baseline gap-[3px] sm:gap-[5px]">
      <span className="font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] text-readout-label sm:tracking-[0.14em]">
        Now
      </span>
      <span className="font-display text-[length:var(--fs-13)] font-medium tabular-nums text-readout-line sm:text-[length:var(--fs-18)]">
        {side.scored.toFixed(1)}
      </span>
    </span>
  );
  const projection = (
    <span
      // The engraving and the halo are one `text-shadow` list, so the blur has
      // to travel as a custom property: a `style` cannot carry a `sm:` variant,
      // and a second declaration would replace the first rather than compose.
      style={{ color: rankColor(percentile), "--fig-glow": rankColor(percentile, 0.4) } as GlowStyle}
      className="font-display text-[length:var(--fs-21)] font-semibold leading-[0.95] tracking-[-0.02em] tabular-nums [text-shadow:var(--figure-engrave),0_0_20px_var(--fig-glow)] sm:text-[length:var(--fs-40)] sm:[text-shadow:var(--figure-engrave),0_0_22px_var(--fig-glow)]"
    >
      {side.live.toFixed(1)}
    </span>
  );

  // **Both rows are `w-full` and the mirroring is `justify-end`**, never
  // `items-end` on the column. A flex item whose `align-self` is not `stretch`
  // is sized `fit-content`, and a render is what showed where that goes: the
  // opponent's label row took its *max-content* inside a 136px column, so a
  // long team name ran 188px past the card's own edge instead of truncating,
  // while the reader's own column — stretched, because it is the default —
  // truncated correctly. Two columns of one part behaving differently is the
  // failure, and a definite width is what makes the `truncate` inside mean
  // something on both.
  const justify = mirrored ? "justify-end" : "";
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:gap-1">
      <span className={`flex w-full min-w-0 items-baseline gap-1.5 sm:gap-2 ${justify}`}>
        {mirrored ? (
          <>
            {teamName}
            {roleLabel}
          </>
        ) : (
          <>
            {roleLabel}
            {teamName}
          </>
        )}
      </span>
      <span className={`flex w-full items-baseline gap-[5px] sm:gap-2.5 ${justify}`}>
        {mirrored ? (
          <>
            {now}
            {projection}
          </>
        ) : (
          <>
            {projection}
            {now}
          </>
        )}
      </span>
      <span className="sr-only">{sentence}</span>
    </div>
  );
}

/**
 * One side's bar: the live projection as a ghost, what has been scored in front
 * of it, and the league's median as a tick across both.
 *
 * **The tick overhangs the track, so the clip is on the track and not on this
 * box.** An `overflow-hidden` here would cut the one thing the two bars have in
 * common down to the height of the bar it is crossing.
 */
function GaugeBar({
  mine = false,
  reading,
  median,
}: {
  /** The reader's own bar: lit stock, and it grows from the centre outward. */
  mine?: boolean;
  reading: { ghost: number; live: number };
  median: number | null;
}) {
  const edge = mine ? "right-0" : "left-0";
  return (
    <div className="relative h-3 sm:h-3.5">
      <div
        className={`absolute inset-0 overflow-hidden bg-[color:var(--figure-well-bg)] shadow-[var(--figure-well-shadow)] ${
          mine
            ? "rounded-l-[6px] rounded-r-[3px] sm:rounded-l-[7px]"
            : "rounded-l-[3px] rounded-r-[6px] sm:rounded-r-[7px]"
        }`}
      >
        <span
          className={`lab-anim absolute inset-y-0 ${edge} transition-[width] duration-300 ${
            mine ? "bg-[color:var(--lit-bar-ghost)]" : "bg-[color:var(--rival-bar-ghost)]"
          }`}
          style={{ width: `${reading.ghost}%` }}
        />
        <span
          className={`lab-anim absolute inset-y-0 ${edge} transition-[width] duration-300 ${
            mine
              ? "bg-[image:var(--lit-bar-bg)] shadow-[var(--lit-bar-shadow)]"
              : "bg-[image:var(--rival-bar-bg)]"
          }`}
          style={{ width: `${reading.live}%` }}
        />
      </div>
      {median !== null && (
        <span
          className="absolute -bottom-[5px] -top-[5px] w-[3px] rounded-[2px] bg-[color:var(--median-ink)] shadow-[0_0_8px_var(--median-glow)] sm:-bottom-1.5 sm:-top-1.5"
          style={mine ? { right: `${median}%` } : { left: `${median}%` }}
        />
      )}
    </div>
  );
}

/**
 * The league's median as a milled strip under the glass.
 *
 * **Drawn only where the league runs one** — there is no `Med —` state, on the
 * standing strip's own rule that a league without a median has no such field
 * and a dash there would read as one the read failed to fetch.
 *
 * The swatch is the same 3px object as the tick on the bars, and that is the
 * whole of what ties the two: a reader who has seen the amber line cross their
 * bar finds the figures it stands for directly beneath it.
 */
function MedianStrip({
  mine,
  median,
}: {
  mine: GametimeSide;
  median: { scored: number; live: number };
}) {
  // The median's own figure is coloured by where the *reader* stands against
  // it, which is the question a median is on the card to answer: green is a
  // week they are on course to beat the league's middle.
  const percentile = sharePercentile(mine.live, [mine.live, median.live]);

  return (
    <div className="relative mt-2 pointer-fine:[transform:translateZ(18px)]">
      <StandingStrip stretch>
        <span className="relative inline-flex shrink-0 items-center gap-[7px] px-[7px] sm:gap-2 sm:px-2.5">
          <span
            aria-hidden
            className="block h-[18px] w-[3px] rounded-[2px] bg-[color:var(--median-ink)] shadow-[0_0_8px_var(--median-glow)] sm:h-5"
          />
          <span className="whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--median-ink)] [text-shadow:var(--standing-engrave)] sm:text-[length:var(--fs-10)] sm:tracking-[0.16em]">
            {/* Two spans switched by the cascade, never state: a client
                component must not have to hydrate to learn a breakpoint. */}
            <span className="sm:hidden">Med</span>
            <span className="hidden sm:inline">Median</span>
          </span>
        </span>

        {/* `transparent` rather than no glow at all: `StandingBay` composes its
            engraving and its halo into one `text-shadow` list, so a bay that
            wants the engraving and nothing else asks for a halo of nothing. */}
        <StandingBay label="Now" stretch tone="var(--billet-figure)" glow="transparent">
          {median.scored.toFixed(1)}
        </StandingBay>
        <StandingBay
          label="Live"
          stretch
          tone={rankColor(percentile)}
          glow={rankColor(percentile, 0.35)}
        >
          {median.live.toFixed(1)}
        </StandingBay>
      </StandingStrip>
      <span className="sr-only">
        League median: on course for {median.live.toFixed(1)}, {median.scored.toFixed(1)} scored so
        far
      </span>
    </div>
  );
}

/** The halo's colour, as a custom property a `pointer`-agnostic class reads. */
type GlowStyle = CSSProperties & { "--fig-glow": string };
