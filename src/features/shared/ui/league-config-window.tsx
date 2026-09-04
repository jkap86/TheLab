import type { ManagerLeague } from "@/shared/contract";

import { CONSOLE_WINDOW } from "../console-chrome";
import {
  isBestBall,
  leagueType,
  scoringValue,
  slotCount,
  TYPE_OPTIONS,
} from "../league-filters";
import { Scanlines } from "./card-plate";

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

export function LeagueConfigWindow({
  league,
  className = "",
}: {
  league: ManagerLeague;
  /** Placement and plane — see the module note. */
  className?: string;
}) {
  // Two exact groups rather than the union, so the window *states* the lineup's
  // QB shape instead of naming it. `qbEligible` is still read, for the one case
  // two ladders cannot state — see the tag below.
  const qb = slotCount(league, "QB");
  const sf = slotCount(league, "SUPER_FLEX");
  const qbEligible = slotCount(league, "QB+SF");
  const te = slotCount(league, "TE");
  const starters = slotCount(league, "STARTERS");
  const teams = league.total_rosters > 0 ? league.total_rosters : null;
  const tePremium = scoringValue(league, "bonus_rec_te");

  return (
    <div
      className={`${CONSOLE_WINDOW} flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-[0.625rem] px-3.5 py-2.5 ${className}`}
    >
      <Scanlines />

      {/* What game. */}
      <span className="relative inline-flex flex-nowrap items-center gap-[0.375rem] whitespace-nowrap">
        <Tag lit>{TYPE_LABELS.get(leagueType(league)) ?? "Redraft"}</Tag>
        {/* The lineup mode is stated either way — "Managed" is a fact about the
            league, and a tag that appeared only for best ball would leave the
            reader to infer the common case from an absence. It is unlit because
            it is the one of the three that is usually the default. */}
        <Tag>{isBestBall(league) ? "Best ball" : "Managed"}</Tag>
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
        {qbEligible !== null && qbEligible >= 2 && (sf ?? 0) < 1 && (
          <Tag lit>Superflex</Tag>
        )}
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
      <span className="relative inline-flex flex-nowrap items-center gap-3.5 whitespace-nowrap">
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
        "rounded-[0.3125rem] border px-[0.4375rem] py-[0.1875rem] font-mono text-[0.625rem] uppercase tracking-[0.14em] " +
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
      <span className="font-mono text-[0.5625rem] uppercase tracking-[0.16em] text-readout-label">
        {label}
      </span>
      <span className="font-mono text-[0.8125rem] tabular-nums text-readout-line">
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
      <span className="font-mono text-[0.5625rem] uppercase tracking-[0.16em] text-readout-label">
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
      <span className="font-mono text-[0.75rem] tabular-nums text-readout-line">
        {slots ?? "—"}
      </span>
    </span>
  );
}
