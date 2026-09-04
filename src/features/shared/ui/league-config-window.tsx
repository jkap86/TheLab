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
  const qb = slotCount(league, "QB+SF");
  const te = slotCount(league, "TE");
  const starters = slotCount(league, "STARTERS");
  const teams = league.total_rosters > 0 ? league.total_rosters : null;
  const tePremium = scoringValue(league, "bonus_rec_te");

  return (
    <div
      className={`${CONSOLE_WINDOW} flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-[0.625rem] px-3.5 py-2.5 ${className}`}
    >
      <Scanlines />

      <span className="relative inline-flex items-center gap-1.5">
        <Tag lit>{TYPE_LABELS.get(leagueType(league)) ?? "Redraft"}</Tag>
        {/* The lineup mode is stated either way — "Managed" is a fact about the
            league, and a tag that appeared only for best ball would leave the
            reader to infer the common case from an absence. It is unlit because
            it is the one of the three that is usually the default. */}
        <Tag>{isBestBall(league) ? "Best ball" : "Managed"}</Tag>
        {/* Superflex is the same reading `SLOT_GROUPS`' hint states and
            `shared/ktc/roster` prices on: two or more QB-eligible starting
            slots. Absent rather than negated — "not superflex" is what every
            other league on the page already looks like. */}
        {qb !== null && qb >= 2 && <Tag lit>Superflex</Tag>}
      </span>

      <Divider />

      <Field label="Teams">{teams ?? "—"}</Field>
      <Field label="Starters">{starters ?? "—"}</Field>

      <Divider />

      <Ladder label="QB+SF" slots={qb} />
      <Ladder label="TE" slots={te} />

      {/* After the TE ladder deliberately: the premium is a fact about the slot
          beside it, not another number on the league's own scale. */}
      <Field label="TE prem">{tePremium ?? "—"}</Field>
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
