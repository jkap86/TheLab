import type { ReactNode } from "react";

import type { ManagerLeague } from "@/shared/contract";

import { CONSOLE_CHIP, CONSOLE_CHIP_TRAY } from "../console-chrome";
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
} from "./card-plate";

/**
 * What game this league is playing, as one **milled strip** across the card.
 *
 * On `/manager` it replaces the identity line that used to sit here —
 * `team name · N-team · status`. The team name went because the card is about
 * the league rather than about what the manager called their team in it, the
 * status went because it was a word nobody acted on, and the team count moved
 * *into* the strip where it is the scale every slot count beside it is read
 * against.
 *
 * **It was lit glass and is metal now, which is the point rather than the
 * finish.** The card's other bolted-on part is the standing strip below it, and
 * the two were cut from different stock: one a readout reporting on itself, one
 * a machined part. They are the same stock now — `--billet-bg` under the same
 * grain and specular, the same `--standing-strip-shadow` chamfer, the same
 * wells and the same engraved ink — so a reader sees two parts of one
 * instrument rather than a window sitting next to a plate. What survives of the
 * window is the *distinction it drew*: a lit tag is still the one thing on the
 * line a reader picks out before reading it, and it is lit in the metal's own
 * accent ink now rather than in the readout's mint. See `--billet-accent`.
 *
 * **It lives in `features/shared` because a trade card reads it too**, on the
 * line that moved `CONSOLE_KEY`, `ManagerPlate` and `card-plate.tsx` here: a
 * second reader. What it answers is the question `/trades` could not otherwise
 * ask of a card — a haul is worth a different thing in a dynasty superflex
 * league than in a redraft one, and until this landed the board printed both
 * under the same numbers with nothing on the card saying which game it was.
 * Since the three cards read the same rules, a league described one way on
 * `/manager` cannot be described another on `/trades` or `/lineupchecker` —
 * which is also why the redesign lands on all three rather than on the one page
 * the handoff behind it scopes. Two arrangements of one read is what
 * {@link LeagueChipRail} is; two *spellings of one arrangement* is the drift
 * the convergence pass removed.
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
 * the same reason: three cards mount this and only the card knows its own
 * surroundings. A manager card is a 3D context and gives the strip
 * `translateZ(18px)`, between the windows' 22px and the plates, so its planes
 * read front-to-back; a trade card is flat, and a `translateZ` there would buy
 * a composited layer per card on a board that appends a hundred at a time and
 * never unmounts one.
 *
 * **One line that never wraps, at every width.** The readings used to sit loose
 * in a wrapping row and break wherever the width ran out — a label stranded on
 * one line with its number on the next, and, below `lg`, `TE prem` dropped onto
 * a line of its own. Three groups on `flex-nowrap` is the arrangement instead:
 * *what game* (the tags), *the scale* (teams and starters) and *the lineup*
 * (the three ladders and the premium), each `shrink-0 whitespace-nowrap` with a
 * groove between, so the line is one instrument reading rather than a paragraph
 * of settings.
 *
 * **A narrow line gives up words and one redundancy, never a reading**, and it
 * gives them up in **two stages at two measured widths**. A line that does not
 * wrap is a line that *clips*, silently — the strip's own `overflow-hidden` is
 * what would do it — so both thresholds are numbers rather than tastes. Every
 * figure below is the content the groups actually need against the content box
 * the card actually gives them, at `--type-scale`.
 *
 * - **Below `md` the pips go and the TE premium folds onto the TE ladder's own
 *   figure** as `1+0.5` (see {@link narrowTeFigure}). The full line needs
 *   **611–619px** and the card's content box is **544px at 640** and **672px at
 *   768** — so it clips through the whole `sm` band and fits from `md` with
 *   ~55px to spare. The pips are the only thing on the line that says something
 *   the figure beside them already says, and the premium is a fact about the
 *   slot it now rides, so those two are what a width buys back. Dropped, the
 *   line needs ~512px and clears 640 comfortably.
 * - **Below `sm` the words shorten too** — `Dynasty` → `Dyn`, `Teams` → `Tm`.
 *   That arm needs **278–293px** against a **314px** box at 390.
 *
 * Both spellings of every switched word are in the DOM with one
 * `display: none`, which is out of the accessibility tree as well as off the
 * screen: see {@link Word}.
 *
 * **The lines that cannot be made to fit are allowed to wrap**, and there are
 * two of them. Wrapping loses no reading where clipping loses the tail of one,
 * and the groups being `shrink-0 whitespace-nowrap` is what keeps the break
 * between two of them rather than through the middle of a label.
 *
 * - The **Superflex shape** below — the only league that carries a *third* tag.
 *   It needs 349px at 390 against 314, and 697px at 768 against 672, so no
 *   abbreviation reaches it: the tag is a whole extra part, not a longer word.
 * - **A strip sharing its row**, which is `shared` and is the manager card at
 *   every width. Every measurement above is against the card's *whole* content
 *   box, and the standing bays beside it take ~230px of that — so the two
 *   thresholds no longer describe the box the line is actually in, and the `md`
 *   arm that fits 512px into 672 does not fit it into ~440. Wrapping is what
 *   makes the shared row safe without a third set of measured words, and it
 *   costs a second line only on the cards narrow enough to need one.
 *
 * The `gap` follows the arm rather than being one number, and that is the same
 * argument one axis over: a wrapping row spends its column gap on the break
 * too, so the 12px that reads as separation on one line reads as a hole between
 * two. A wrapping strip takes 10px, the design's own figure for it.
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
  shared = false,
  className = "",
}: {
  league: ManagerLeague;
  /**
   * Whether the strip is sharing its row with another part — see the wrap note
   * in the module comment. The manager card stands the standing bays beside
   * it; the trade card and the lineup checker give it the row.
   */
  shared?: boolean;
  /** Placement and plane — see the module note. */
  className?: string;
}) {
  const config = readLeagueConfig(league);
  const { format, lineup, qb, sf, te, starters, teams, tePremium } = config;
  // **Two questions, and they must not share a variable.** `unnamedSf` is a
  // claim about the league — it draws a third tag — and `wraps` is a fact about
  // the box the line is in. They were one `crowded` when the tag was the only
  // thing that could overflow the line; folding `shared` into it drew a
  // Superflex tag on every league the manager card lists, which is a false
  // statement about the league rather than a layout fault, and one nothing on
  // screen contradicts.
  const unnamedSf = isUnnamedSuperflex(config);
  const wraps = unnamedSf || shared;

  return (
    <div
      className={`relative flex items-center overflow-hidden rounded-[0.625rem] border border-foreground/13 bg-[image:var(--billet-bg)] px-2 py-[5px] shadow-[var(--standing-strip-shadow)] sm:px-3 sm:py-[7px] ${
        wraps
          ? "flex-wrap gap-x-1 gap-y-1 sm:gap-x-2.5"
          : "flex-nowrap gap-1 sm:gap-3"
      } ${className}`}
    >
      <BilletFinish />

      {/* What game. */}
      <span className="relative inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap">
        <Tag lit wide={format} narrow={FORMAT_SHORT[format] ?? format} />
        {/* The lineup mode is stated either way — "Managed" is a fact about the
            league, and a tag that appeared only for best ball would leave the
            reader to infer the common case from an absence. It is unlit because
            it is the one of the three that is usually the default. */}
        <Tag wide={lineup} narrow={LINEUP_SHORT[lineup] ?? lineup} />
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
          never renders and the strip is the design as drawn, and if one does,
          the reader is not left to infer superflex from two ladders that never
          name it. It stays until the query is run.

          It abbreviates like the two beside it, and that is not enough: it is
          the only tag that can ever be a *third* one, and a third part is a
          width no shorter word buys back — which is why it is one of the two
          things that make the line wrap. See the wrap note on the component
          above, and `wraps` for why that is a second variable rather than this
          one reused.
        */}
        {unnamedSf && <Tag lit wide="Superflex" narrow="SFlx" />}
      </span>

      <Divider />

      {/* The scale. */}
      <span className="relative inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap sm:gap-3">
        <Field label="Teams" narrowLabel="Tm">
          {teams ?? NO_FIGURE}
        </Field>
        <Field label="Starters" narrowLabel="St">
          {starters ?? NO_FIGURE}
        </Field>
      </span>

      <Divider />

      {/* The lineup. `SF 0` on a one-QB league is the statement to want, and
          the two-pip floor is what makes it one: none of the one this board
          could have. A null count still draws no ladder — see {@link Ladder}.

          The TE premium comes after the TE ladder deliberately: it is a fact
          about the slot beside it, not another number on the league's own
          scale — which is also why it is inside this group rather than a fourth
          thing loose in the row. Below `md` it is *inside the TE ladder's own
          figure*, which is that same argument taken one step further by a
          width — see {@link narrowTeFigure}. */}
      <span className="relative inline-flex shrink-0 items-center gap-1 whitespace-nowrap sm:gap-3">
        <Ladder label="QB" slots={qb} />
        <Ladder label="SF" slots={sf} />
        <Ladder
          label="TE"
          slots={te}
          narrowFigure={narrowTeFigure(te, tePremium)}
        />
        <span className="hidden md:contents">
          <Field label="TE prem">{tePremium ?? NO_FIGURE}</Field>
        </span>
      </span>
    </div>
  );
}

/** No answer for a field, in the app's own grammar: never a zero. */
const NO_FIGURE = "—";

/**
 * The words a phone gives up, and they are only ever *words*.
 *
 * **Every reading the wide line states is on the narrow line too** — the strip
 * abbreviates, it does not drop a field. The tags are the widest things on it
 * and so the ones that shorten, below `sm`; `Teams`/`Starters` shorten with
 * them. What the line gives up at the *other* threshold is one redundancy and
 * one relocation rather than a word: see the component note above.
 */
const FORMAT_SHORT: Record<string, string> = {
  Redraft: "Rdr",
  Keeper: "Keep",
  Dynasty: "Dyn",
  Chopped: "Chop",
};

const LINEUP_SHORT: Record<string, string> = {
  Managed: "Mgd",
  "Best ball": "BB",
};

/**
 * The TE ladder's figure where there is no room for a bay beside it: the slot
 * count with its premium on it.
 *
 * A bay of its own is the widest thing a narrow line cannot afford, and the
 * premium is a fact about the slot rather than another number on the league's
 * scale — so it rides that slot's figure, which is the same argument that puts
 * it inside the lineup group at every width.
 *
 * **It is a pair only where both halves are real.** `1+0.5` is a reading;
 * `—+0.5` and `1+—` are two figures a reader has to guess the shape of at
 * `--fs-12` with one label between them. So a null slot count answers the
 * dash it would answer anyway, and an unknown premium — a league whose
 * `scoring_settings` were never synced — leaves the figure alone. Nothing is
 * lost by the second: what the wide line states there is `TE prem —`, which is
 * itself the absence of a reading. A **zero** premium is a real answer and is
 * carried, per {@link scoringValue}.
 */
function narrowTeFigure(
  slots: number | null,
  premium: number | null,
): string | number {
  if (slots === null) return NO_FIGURE;
  if (premium === null) return slots;
  return `${slots}+${premium}`;
}

/**
 * A word switched by the cascade, where two widths spell it differently.
 *
 * Both spellings are in the DOM and one is `display: none`, which takes it out
 * of the accessibility tree as well as off the screen — so a reader is never
 * read the same fact twice. It is the rule the rank window's own scope line
 * already lives by, one component over.
 *
 * **Two breakpoints, because the line gives things up in two stages** — see
 * {@link LeagueConfigWindow}'s note on where each threshold came from. The
 * classes are spelled out per arm rather than interpolated, since Tailwind
 * generates what it can see.
 */
function Word({
  wide,
  narrow,
  at = "sm",
}: {
  wide: string;
  narrow: string;
  /** The width above which the long spelling is used. */
  at?: "sm" | "md";
}) {
  if (wide === narrow) return <>{wide}</>;
  return at === "md" ? (
    <>
      <span className="md:hidden">{narrow}</span>
      <span className="hidden md:inline">{wide}</span>
    </>
  ) : (
    <>
      <span className="sm:hidden">{narrow}</span>
      <span className="hidden sm:inline">{wide}</span>
    </>
  );
}

/**
 * A word about the league, stamped into a well cut in the strip's own face.
 *
 * **Two weights and no third**, as before: `lit` is the billet family's own
 * accent with the accent glow behind it, unlit is `--billet-scope`. What
 * changed with the material is what "unlit" is made of — on glass the dimmer
 * state moved the readout's ink, and on metal it moves down the metal's own
 * ink family. Neither is the accent at an alpha, which light mode's teal
 * cannot survive.
 *
 * The engraving is `--standing-engrave` and the well is the standing strip's,
 * which is the point of the redesign: the two parts on this card are cut from
 * one piece of stock.
 */
function Tag({
  wide,
  narrow,
  lit,
}: {
  wide: string;
  narrow: string;
  lit?: boolean;
}) {
  return (
    <span
      className={
        "rounded-[0.3125rem] bg-[image:var(--billet-well-bg)] px-[7px] py-0.5 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] shadow-[var(--standing-well-shadow)] sm:text-[length:var(--fs-10)] " +
        (lit
          ? "text-[color:var(--billet-accent)] [text-shadow:var(--standing-engrave),0_0_12px_var(--accent-glow)]"
          : "text-[color:var(--billet-scope)] [text-shadow:var(--standing-engrave)]")
      }
    >
      <Word wide={wide} narrow={narrow} />
    </span>
  );
}

/**
 * The groove between two groups of readings — a channel milled into the part.
 *
 * It was a line drawn on glass (`color-mix` over `--readout-label`), which was
 * right when this was a window: a groove is a channel cut into metal and there
 * was no metal here to cut. The strip is metal, so it is `--groove` now, on the
 * same cut the plate row above it already makes — and, being a token, it turns
 * over for light mode where a `color-mix` on a readout ink could only dim.
 *
 * `shrink-0` is load-bearing on a line that never wraps: the row is
 * `flex-nowrap`, so a 1px divider left shrinkable is the first thing to
 * disappear under pressure and it would go without a trace.
 */
function Divider() {
  return (
    <span
      aria-hidden
      className="relative h-4 w-px shrink-0 bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
    />
  );
}

/** A label stamped into the part's face. */
function Label({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)]">
      {children}
    </span>
  );
}

/** A figure engraved into it, on the one ink every figure on this part shares. */
function Figure({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[length:var(--fs-12)] tabular-nums text-[color:var(--billet-figure)] [text-shadow:var(--standing-engrave)] sm:text-[length:var(--fs-13)]">
      {children}
    </span>
  );
}

/** A label and its number. */
function Field({
  label,
  narrowLabel,
  children,
}: {
  label: string;
  /** The same label shortened, where a phone's line cannot carry the word. */
  narrowLabel?: string;
  children: string | number;
}) {
  return (
    <span className="relative inline-flex items-baseline gap-[5px]">
      <Label>
        <Word wide={label} narrow={narrowLabel ?? label} />
      </Label>
      <Figure>{children}</Figure>
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
 *
 * **The pips are the one reading a phone drops, and they are the only one it
 * can.** A pip row is a second spelling of the figure beside it — the whole
 * point of it is to be countable at a glance on a line a reader is scanning —
 * so at 390 the figure carries it alone and nothing is lost but the glance.
 * Their colour is the chip rail's own pair, which is the same pip on the same
 * stock: a slot milled into the metal, lit or not, measured for both schemes.
 */
function Ladder({
  label,
  slots,
  narrowFigure,
}: {
  label: string;
  slots: number | null;
  /** What the figure says at a width with no room for a bay beside it. */
  narrowFigure?: string | number;
}) {
  const total = slots === null ? 0 : Math.max(2, slots);
  const figure = slots ?? NO_FIGURE;

  return (
    <span className="relative inline-flex items-center gap-1.5">
      <Label>{label}</Label>
      {total > 0 && (
        <span aria-hidden className="hidden items-center gap-[2px] md:inline-flex">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={
                "block h-[13px] w-[4px] rounded-[2px] " +
                (i < (slots ?? 0)
                  ? "bg-[image:var(--pip-lit-bg)] shadow-[var(--pip-lit-shadow)]"
                  : "bg-[color:var(--pip-unlit-bg)] shadow-[var(--pip-unlit-shadow)]")
              }
            />
          ))}
        </span>
      )}
      <Figure>
        {narrowFigure === undefined ? (
          figure
        ) : (
          <Word at="md" wide={String(figure)} narrow={String(narrowFigure)} />
        )}
      </Figure>
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
