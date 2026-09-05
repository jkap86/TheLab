import type { ReactNode } from "react";

import type { ManagerLeague } from "@/shared/contract";

import { CONSOLE_CHIP, CONSOLE_CHIP_TRAY, CONSOLE_WINDOW } from "../console-chrome";
import {
  isBestBall,
  leagueType,
  scoringValue,
  slotCount,
  TYPE_OPTIONS,
} from "../league-filters";
import {
  BilletFinish,
  LedgeBay,
  LedgeFigure,
  MilledHairline,
  Scanlines,
} from "./card-plate";

/**
 * What game this league is playing, as one lit window across the card.
 *
 * On `/manager` it replaces the identity line that used to sit here —
 * `team name · N-team · status`. The team name went because the card is about
 * the league rather than about what the manager called their team in it, the
 * status went because it was a word nobody acted on, and the team count moved
 * *into* the window where it is the scale every slot count beside it is read
 * against.
 *
 * **It lives in `features/shared` because a trade card reads it too**, on the
 * line that moved `CONSOLE_KEY`, `ManagerPlate` and `card-plate.tsx` here: a
 * second reader. What it answers is the question `/trades` could not otherwise
 * ask of a card — a haul is worth a different thing in a dynasty superflex
 * league than in a redraft one, and until this landed the board printed both
 * under the same numbers with nothing on the card saying which game it was.
 * Since the two cards read the same rules, a league described one way on
 * `/manager` cannot be described another on `/trades`.
 *
 * **Nothing here is derived twice.** Every rule already has exactly one
 * spelling in `features/shared/league-filters`, and this reads them:
 * {@link leagueType} for the format (an absent `type` is redraft),
 * {@link isBestBall} for the lineup mode, {@link slotCount} for the ladders and
 * the starter count, {@link scoringValue} for the TE premium. A second copy of
 * any of them is a second chance to get one of Sleeper's quirks wrong, and the
 * card would then disagree with the Filters dialog about which leagues are
 * which — the failure that shows up as a filter returning the wrong rows rather
 * than as an error.
 *
 * **Null is not zero, in both directions.** `slotCount` answers null for a
 * league whose `roster_positions` were never synced, and a ladder drawn with no
 * pips lit would claim the league starts no quarterback; `total_rosters` of 0 is
 * a row stored before the league answered, not an 0-team league. Both render an
 * em dash, and a null ladder draws **no pips at all** rather than an empty pair.
 * An absent *scoring* key is a real 0, which is why TE premium is asked as a
 * value rather than as a flag — see {@link scoringValue}.
 *
 * **Where it sits and what plane it sits on are the caller's**, which is why
 * they arrive as a `className` rather than being written in here — the same
 * arrangement `LeagueFiltersDialog` takes its `triggerClassName` by, and for
 * the same reason: two cards mount this and only the card knows its own
 * surroundings. A manager card is a 3D context and gives the window
 * `translateZ(18px)`, between the tiles' 22px and the plates, so its planes
 * read front-to-back; a trade card is flat, and a `translateZ` there would buy
 * a composited layer per card on a board that appends a hundred at a time and
 * never unmounts one.
 *
 * **The readings are three groups, and each wraps whole.** They used to sit
 * loose in the flex row, so a narrow card broke the line wherever it ran out of
 * width — between the QB and SF ladders, or between `Teams` and `Starters`,
 * leaving a label stranded on a line of its own with its number on the next.
 * The three are *what game* (the format and lineup-mode tags), *the scale*
 * (teams and starters) and *the lineup* (the three ladders and the TE premium),
 * each an `inline-flex` `whitespace-nowrap` span, so the only wrap points left
 * are the two between them. The dividers stay siblings *between* the groups —
 * two of them, not five — which is what lets the window's own `gap-x` space
 * them and keeps a divider from ever ending a wrapped line.
 *
 * **The lineup group is the one exception, below `lg`.** Three ladders and the
 * TE premium are the widest of the three and they are the group that outgrew
 * the window: at a phone's width, with the page's type scaled up, the row
 * measures wider than the card and `TE prem` is clipped by the window's own
 * edge — silently, because a `whitespace-nowrap` span in a wrapping row simply
 * overflows. So this one group wraps internally there and `TE prem` drops to a
 * line under the ladders, which is the field that reads correctly on a line of
 * its own: it is a fact about the TE slot rather than another number on the
 * league's scale, so it does not have to sit beside the ladder to be read.
 * `gap-y-2` is what keeps the two lines from touching. Above `lg` nothing
 * changed — the group is `flex-nowrap whitespace-nowrap` again, and the
 * boundaries between the three groups are untouched at every width.
 *
 * Like every lit surface on the card it carries its own scanlines, and like
 * every one of them the layer is a child rather than a second background,
 * because CSS has no way to spell the overlay on an element that already has
 * one.
 */

/** The four format words, off the same table the Type rail renders. */
const TYPE_LABELS = new Map(
  TYPE_OPTIONS.filter((option) => option.value !== "all").map((option) => [
    Number(option.value),
    option.label,
  ]),
);

/**
 * Everything either reading of a league's configuration is made of, derived
 * once.
 *
 * The window and the chip rail below are two arrangements of one set of facts,
 * and the module's whole promise is that no rule here is spelled twice — so the
 * reading of it is not spelled twice either. A second copy would be a second
 * chance to forget that Sleeper omits `type` on a redraft league, or that a
 * `total_rosters` of 0 is a row stored before the league answered, and the
 * symptom would be a card describing one game on `/manager` and another on
 * `/trades`.
 */
function readLeagueConfig(league: ManagerLeague) {
  return {
    format: TYPE_LABELS.get(leagueType(league)) ?? "Redraft",
    lineup: isBestBall(league) ? "Best ball" : "Managed",
    // Two exact groups rather than the union, so both readings *state* the
    // lineup's QB shape instead of naming it. `qbEligible` is still read, for
    // the one case two ladders cannot state — see the Superflex tag.
    qb: slotCount(league, "QB"),
    sf: slotCount(league, "SUPER_FLEX"),
    qbEligible: slotCount(league, "QB+SF"),
    te: slotCount(league, "TE"),
    starters: slotCount(league, "STARTERS"),
    teams: league.total_rosters > 0 ? league.total_rosters : null,
    tePremium: scoringValue(league, "bonus_rec_te"),
  };
}

/**
 * The one shape two ladders cannot state: a league starting two bare `QB` slots
 * and no `SUPER_FLEX` at all.
 *
 * It prices exactly like a superflex league and looks, on the ladders, like a
 * league that simply starts two quarterbacks — so both readings carry a tag
 * narrowed to precisely that disagreement, and neither draws one otherwise.
 */
function isUnnamedSuperflex(config: ReturnType<typeof readLeagueConfig>): boolean {
  return (
    config.qbEligible !== null &&
    config.qbEligible >= 2 &&
    (config.sf ?? 0) < 1
  );
}

export function LeagueConfigWindow({
  league,
  className = "",
}: {
  league: ManagerLeague;
  /** Placement and plane — see the module note. */
  className?: string;
}) {
  const config = readLeagueConfig(league);
  const { format, lineup, qb, sf, te, starters, teams, tePremium } = config;

  return (
    <div
      className={`${CONSOLE_WINDOW} flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-[0.625rem] px-3.5 py-2.5 ${className}`}
    >
      <Scanlines />

      {/* What game. */}
      <span className="relative inline-flex flex-nowrap items-center gap-[0.375rem] whitespace-nowrap">
        <Tag lit>{format}</Tag>
        {/* The lineup mode is stated either way — "Managed" is a fact about the
            league, and a tag that appeared only for best ball would leave the
            reader to infer the common case from an absence. It is unlit because
            it is the one of the three that is usually the default. */}
        <Tag>{lineup}</Tag>
        {/*
          The Superflex tag used to appear on every league the `QB+SF ≥ 2` rule
          matched, and the two ladders below say that outright for the ordinary
          shape: `QB 1 · SF 1` is a superflex lineup and reads as one. What they
          cannot say is the *other* shape the union matches — a league starting
          two bare `QB` slots and no `SUPER_FLEX` at all, which prices exactly
          like a superflex league and looks, on the ladders, like a league that
          simply starts two quarterbacks. So the tag survives narrowed to
          precisely that disagreement.

          Whether the shape exists in this corpus is the open question the
          handoff raised and could not be answered here (no database is reachable
          from where this was built). Narrowing rather than deleting is the arm
          that is correct under both answers: if no such league exists the tag
          never renders and the window is the design as drawn, and if one does,
          the reader is not left to infer superflex from two ladders that never
          name it. It stays until the query is run.
        */}
        {isUnnamedSuperflex(config) && <Tag lit>Superflex</Tag>}
      </span>

      <Divider />

      {/* The scale. */}
      <span className="relative inline-flex flex-nowrap items-baseline gap-3.5 whitespace-nowrap">
        <Field label="Teams">{teams ?? "—"}</Field>
        <Field label="Starters">{starters ?? "—"}</Field>
      </span>

      <Divider />

      {/* The lineup. `SF 0` on a one-QB league is the statement to want, and
          the two-pip floor is what makes it one: none of the one this board
          could have. A null count still draws no ladder — see {@link Ladder}.

          The TE premium comes after the TE ladder deliberately: it is a fact
          about the slot beside it, not another number on the league's own
          scale — which is also why it is inside this group rather than a fourth
          thing loose in the row. */}
      <span className="relative inline-flex flex-wrap items-center gap-x-3.5 gap-y-2 lg:flex-nowrap lg:whitespace-nowrap">
        <Ladder label="QB" slots={qb} />
        <Ladder label="SF" slots={sf} />
        <Ladder label="TE" slots={te} />
        <Field label="TE prem">{tePremium ?? "—"}</Field>
      </span>
    </div>
  );
}

/**
 * A word about the league, on the readout's own type.
 *
 * Two weights and no third: `lit` is the accent at full opacity with the inset
 * glow behind it, unlit is a hairline and `--readout-muted`. The accent is
 * never drawn with an alpha as text — light mode's teal is already near its
 * contrast floor — so the dimmer state moves the *ink* rather than fading it.
 */
function Tag({ children, lit }: { children: string; lit?: boolean }) {
  return (
    <span
      className={
        "rounded-[0.3125rem] border px-[0.4375rem] py-[0.1875rem] font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] " +
        (lit
          ? "border-active/40 text-readout [text-shadow:var(--readout-text-glow)] shadow-[inset_0_0_12px_var(--accent-glow)]"
          : "border-active/22 text-readout-muted")
      }
    >
      {children}
    </span>
  );
}

/**
 * A readout's own divider — a line on glass.
 *
 * Deliberately **not** `--groove`, which is milled metal: a groove is a channel
 * cut into the housing, and there is no metal inside a lit window to cut.
 */
function Divider() {
  return (
    <span
      aria-hidden
      className="relative h-[1.125rem] w-px bg-[color-mix(in_srgb,var(--readout-label)_40%,transparent)]"
    />
  );
}

/** A label and its number, on the window's two type sizes. */
function Field({
  label,
  children,
}: {
  label: string;
  children: string | number;
}) {
  return (
    <span className="relative inline-flex items-baseline gap-1.5">
      <span className="font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-readout-label">
        {label}
      </span>
      <span className="font-mono text-[length:var(--fs-13)] tabular-nums text-readout-line">
        {children}
      </span>
    </span>
  );
}

/**
 * A slot count as countable pips, then the figure.
 *
 * **Two pips is the floor**, which is what makes a superflex league visibly
 * different from a one-QB one at a glance: a single lit dot reads as "one", and
 * one of two reads as "one of the two this board could have". Past two the
 * ladder is exact, so a three-QB league draws three lit.
 *
 * A **null** count draws no ladder at all — see the module note. An empty
 * two-pip ladder is a claim that the league starts none of these, which is a
 * different statement from not knowing.
 */
function Ladder({ label, slots }: { label: string; slots: number | null }) {
  const total = slots === null ? 0 : Math.max(2, slots);

  return (
    <span className="relative inline-flex items-center gap-[0.4375rem]">
      <span className="font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-readout-label">
        {label}
      </span>
      {total > 0 && (
        <span aria-hidden className="inline-flex items-center gap-[2px]">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={
                "block h-[13px] w-[5px] rounded-[2px] " +
                (i < (slots ?? 0)
                  ? "bg-active shadow-[0_0_7px_var(--accent-glow)]"
                  : "bg-[color-mix(in_srgb,var(--readout-label)_22%,transparent)]")
              }
            />
          ))}
        </span>
      )}
      <span className="font-mono text-[length:var(--fs-12)] tabular-nums text-readout-line">
        {slots ?? "—"}
      </span>
    </span>
  );
}

/**
 * The same facts as {@link LeagueConfigWindow}, as **four paired chips in a
 * recessed tray** — the manager league card's settings rail.
 *
 * A second arrangement rather than a second derivation: both read
 * {@link readLeagueConfig}, so a league described one way here cannot be
 * described another in the window, and neither can drift from the Filters
 * dialog that narrows by the same rules.
 *
 * **The pairing is the design, and it is not arbitrary.** Seven readings loose
 * in one wide window wrapped wherever the row ran out — which is what put `TE
 * prem` on a line of its own below `lg` and left the reader to work out which
 * ladder it belonged to. Paired, each chip answers one question — *what game*,
 * *what scale*, *what QB shape*, *what TE shape* — and the grouping guarantees
 * the thing the window could only ask for: **TE and its premium can never split
 * across lines**, because they are two bays of one part.
 *
 * **`flex-1 basis-auto`, never `basis-0`**, and the difference is what makes
 * one rule serve both widths. A wrapping flex container breaks lines on each
 * item's *hypothetical* size — its content — and only then distributes the
 * slack within a line, so at a card's full width all four sit on one row and
 * grow into it, while at a phone's the four content widths exceed the tray and
 * it breaks two and two on its own. With `basis-0` every chip would be equally
 * sized and nothing would ever wrap: four chips would shrink to a quarter of
 * 334px and `Starters` would clip. No breakpoint is involved in either.
 *
 * **The tray is a hole and the chips are parts**, which is the whole of why
 * this reads at a glance where a single wide window did not: a reader counts
 * four objects before reading a word of them. See {@link CONSOLE_CHIP_TRAY}.
 *
 * Placement and plane are the caller's, for {@link LeagueConfigWindow}'s reason.
 */
export function LeagueChipRail({
  league,
  className = "",
}: {
  league: ManagerLeague;
  /** Placement and plane — see {@link LeagueConfigWindow}. */
  className?: string;
}) {
  const config = readLeagueConfig(league);
  const { format, lineup, qb, sf, te, starters, teams, tePremium } = config;

  return (
    <div
      className={`${CONSOLE_CHIP_TRAY} flex flex-wrap items-stretch gap-1.5 rounded-[0.8125rem] p-1.5 ${className}`}
    >
      <Chip>
        <LedgeBay label="Format">
          <Lamp />
          <LedgeFigure>{format}</LedgeFigure>
        </LedgeBay>
        <MilledHairline />
        {/* Stated either way: "Managed" is a fact about the league, and a bay
            that appeared only for best ball would leave the reader to infer the
            common case from an absence. */}
        <LedgeBay label="Lineup">
          <LedgeFigure>{lineup}</LedgeFigure>
        </LedgeBay>
      </Chip>

      <Chip>
        <LedgeBay label="Teams">
          <LedgeFigure>{teams ?? "—"}</LedgeFigure>
        </LedgeBay>
        <MilledHairline />
        <LedgeBay label="Starters">
          <LedgeFigure>{starters ?? "—"}</LedgeFigure>
        </LedgeBay>
      </Chip>

      {/* `SF 0` on a one-QB league is the statement to want, and the two-pip
          floor is what makes it one: none of the one this board could have. A
          null count still draws no ladder at all — see {@link ChipLadder}. */}
      <Chip>
        <LedgeBay label="QB">
          <ChipLadder slots={qb} />
          <LedgeFigure>{qb ?? "—"}</LedgeFigure>
        </LedgeBay>
        <MilledHairline />
        <LedgeBay label="SF">
          <ChipLadder slots={sf} />
          <LedgeFigure>{sf ?? "—"}</LedgeFigure>
        </LedgeBay>
      </Chip>

      <Chip>
        <LedgeBay label="TE">
          <ChipLadder slots={te} />
          <LedgeFigure>{te ?? "—"}</LedgeFigure>
        </LedgeBay>
        <MilledHairline />
        <LedgeBay label="TE prem">
          <LedgeFigure>{tePremium ?? "—"}</LedgeFigure>
        </LedgeBay>
      </Chip>

      {/*
        The one reading the ladders cannot make, kept rather than dropped with
        the tags — see {@link isUnnamedSuperflex}. It is a fifth chip rather
        than a bay inside one of the four, because every other chip is a *pair*
        and a lone third bay would break the grammar a reader counts by; and
        because appending it to the TE chip is exactly the split that pairing
        exists to prevent. On the corpus this may never render at all, which is
        the arm that is correct under both answers to a question no render can
        settle.
      */}
      {isUnnamedSuperflex(config) && (
        <Chip>
          <LedgeBay label="Lineup">
            <Lamp />
            <LedgeFigure>Superflex</LedgeFigure>
          </LedgeBay>
        </Chip>
      )}
    </div>
  );
}

/**
 * One raised part of the rail, carrying a pair of bays.
 *
 * The same billet stock as the ledge above it, finish and all — a rail whose
 * chips were cut from different metal is the thing {@link BilletFinish} exists
 * to prevent. `min-h` is the phone's: two chips on a row have to agree on a
 * height whatever their bays contain, and a ladder bay is taller than a plain
 * one.
 */
function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      // **`flex-auto`, never `flex-1`.** Tailwind spells `flex-1` as
      // `flex: 1 1 0%`, which is the `basis-0` case the component note above
      // rules out — and the failure is silent: at 390 the four chips all
      // claimed a zero hypothetical size, so the rail never wrapped, every one
      // of them squeezed to 76px around 120px of content, and each bay clipped
      // its own label to three characters inside the chip's `overflow-hidden`.
      // `flex-auto` is `flex: 1 1 auto`, which is what lets a line break on
      // content and then grow into what is left.
      className={`${CONSOLE_CHIP} relative flex min-h-[2.625rem] min-w-0 flex-auto items-center justify-center gap-2 overflow-hidden rounded-[0.5625rem] px-2 py-[0.3125rem] sm:min-h-0 sm:gap-2.5 sm:px-3 sm:py-2`}
    >
      <BilletFinish />
      {children}
    </span>
  );
}

/** The lit indicator on the format bay — one of the card's two teal moments. */
function Lamp() {
  return (
    <span
      aria-hidden
      className="block h-[0.3125rem] w-[0.3125rem] shrink-0 rounded-full bg-active shadow-[0_0_6px_var(--accent-glow)]"
    />
  );
}

/**
 * A slot count as countable pips, milled into a chip.
 *
 * **Two pips is the floor**, which is what makes a superflex league visibly
 * different from a one-QB one at a glance: a single lit dot reads as "one", and
 * one of two reads as "one of the two this board could have". Past two the
 * ladder is exact, so a three-QB league draws three lit.
 *
 * A **null** count draws no ladder at all. An empty two-pip ladder is a claim
 * that the league starts none of these, which is a different statement from not
 * knowing — the same rule the figure beside it draws its em dash by.
 *
 * The unlit pip is the readability fix this whole pass exists for: it used to
 * be a near-black hole on a dark ground at about 1.15:1, and it is a **light
 * machined slot** now. See `--pip-unlit-bg`.
 */
function ChipLadder({ slots }: { slots: number | null }) {
  if (slots === null) return null;
  const total = Math.max(2, slots);

  return (
    <span aria-hidden className="inline-flex shrink-0 items-center gap-[2px]">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={
            "block h-[15px] w-[3px] rounded-[1px] " +
            (i < slots
              ? "bg-[image:var(--pip-lit-bg)] shadow-[var(--pip-lit-shadow)]"
              : "bg-[color:var(--pip-unlit-bg)] shadow-[var(--pip-unlit-shadow)]")
          }
        />
      ))}
    </span>
  );
}
