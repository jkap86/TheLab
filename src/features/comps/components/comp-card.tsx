"use client";

import { memo } from "react";

import {
  CONSOLE_CARD,
  CardPlateRow,
  LeaguePlate,
  PlateField,
  ReadingPlate,
  rankColor,
} from "@/features/shared";
import type { CompMatch, CompPair } from "@/shared/contract";
import {
  closenessBars,
  criterionById,
  isWindowed,
  observationTag,
  pairKey,
  windowById,
} from "@/shared/comps";

import {
  coverageLabel,
  criterionValue,
  signedDelta,
  weightLabel,
} from "../helpers/format";
import { compSeasonRows, payoffRows } from "../helpers/season-lines";
import { CAPTION, LIT, Window } from "./controls";

/**
 * One comp: the season nearest the subject, and what that player did the
 * year after.
 *
 * **The left pane is the comp season's own line, never a windowed figure**,
 * and the right pane's deltas are measured against it. With a window per
 * criterion there is no single window a pane could be drawn over, and a pane
 * averaging some rows and not others would be a table of mixed units. It
 * also keeps the payoff column honest: the following season is comparable to
 * that season and to nothing else. What each criterion actually read is on
 * its own chip below, tagged with the window it came off.
 *
 * **Both panes draw the lines the comp's position draws**, through
 * `helpers/season-lines` — the one rule the subject housing reads too. The
 * card used to draw a receiver's rows under every position, so a quarterback
 * comp read `Rec yd 0 · Tgt sh 0% · YPRR —` above a rushing figure it never
 * showed.
 *
 * The similarity figure and the deltas take the rank ramp rather than a
 * colour of their own — the same two hues the manager card's tiles run on,
 * and the two that invert for light mode. The chip's closeness is a **bar
 * count** as well as a hue, and a delta carries its sign, so neither reading
 * rests on colour alone.
 *
 * **The similarity is the server's**, not a transform applied here. It is
 * calibrated against the whole eligible pool's distance distribution, and the
 * browser holds only the top `k` of that pool — a percentage computed here
 * would be anchored to ten rows rather than to the field they were drawn from.
 * See `shared/comps/similarity`.
 *
 * **Two things a card says that it used not to.** A row compared on less than
 * the whole question carries a coverage badge, because a distance divided by
 * the weight it *had* cannot say how much of the question it answered — and a
 * comp whose player was not there the following year says so on the payoff
 * pane, because that is a real outcome and zeroes with nothing above them read
 * as a data problem.
 */
export const CompCard = memo(function CompCard({
  comp,
  place,
  of,
  pairs,
  showPayoff,
  similarityMode,
}: {
  comp: CompMatch;
  /** 1-based place in the ranked list. */
  place: number;
  of: number;
  pairs: readonly CompPair[];
  showPayoff: boolean;
  similarityMode: "percent" | "distance";
}) {
  const sim = comp.similarity;
  const tone = rankColor(sim);
  const rookie = comp.years_on_file === 1;
  const coverage = coverageLabel(comp.coverage);
  const played = comp.next.played;

  const leftRows = compSeasonRows(comp);
  const rightRows: { label: string; value: string; delta: number | null; lit?: boolean }[] = [
    ...payoffRows(comp),
    { label: "Finish", value: comp.next.finish ?? "—", delta: null, lit: true },
  ];

  return (
    <li>
      <article className={`${CONSOLE_CARD} font-mono`}>
        <CardPlateRow>
          <LeaguePlate name={`${comp.name} · ${comp.season}`} avatarUrl={null} size="md" />
          <ReadingPlate>
            <PlateField label={similarityMode === "percent" ? "Sim" : "Dist"}>
              <span style={{ color: tone, textShadow: `0 0 10px ${rankColor(sim, 0.55)}` }}>
                {similarityMode === "percent" ? sim : comp.distance.toFixed(2)}
              </span>
            </PlateField>
          </ReadingPlate>
        </CardPlateRow>

        <div
          aria-hidden
          className="relative mb-4 h-1 overflow-hidden rounded-full bg-[color:var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]"
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${sim}%`, background: tone }}
          />
        </div>

        {/* Only where it is below the whole question — see `coverageLabel`. */}
        {coverage && (
          <p
            className="relative -mt-2.5 mb-3.5 inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/[0.04] py-[0.1875rem] pl-[0.4375rem] pr-2 text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-foreground/[0.72]"
            title="Stat coverage measures how much of the selected comparison criteria are available for this historical season. The rest were not scored — a missing stat is never read as a zero."
          >
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
            {coverage}
          </p>
        )}

        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
          <Pane
            title={`${comp.season} season`}
            note={
              rookie
                ? `${comp.position} · rookie · 1 yr on file`
                : `${comp.position} · ${place} of ${of}`
            }
          >
            {leftRows.map((row) => (
              <StatRow key={row.id} label={row.label} value={row.value} />
            ))}
          </Pane>

          {showPayoff && (
            <Pane
              title={`${comp.season + 1} season`}
              // A player who was not there the following year is a real
              // outcome and the most important one on the board — see
              // `CompNextSeason.played`. Zeroes with `vs 2021` over them read
              // as a gap in the data, which is the one thing they are not.
              note={played ? `vs ${comp.season}` : "did not play"}
            >
              {rightRows.map((row) => (
                <StatRow key={row.label} label={row.label} value={row.value} lit={row.lit}>
                  <span
                    className="min-w-[2.75rem] shrink-0 text-right text-[length:var(--fs-11)] tabular-nums"
                    style={{ color: deltaTone(row.delta) }}
                  >
                    {row.delta === null
                      ? ""
                      : signedDelta(row.delta, row.label === "PPG" ? 1 : 0)}
                  </span>
                </StatRow>
              ))}
            </Pane>
          )}
        </div>

        <div className="relative mt-3.5 flex flex-wrap items-center gap-1.5">
          <span className={`mr-1 ${CAPTION}`}>Matched on</span>
          {pairs.map((pair) => (
            <Chip key={pairKey(pair.criterion, pair.window)} comp={comp} pair={pair} />
          ))}
        </div>
      </article>
    </li>
  );
});

/**
 * A positive delta takes the ramp's green end and a negative its red, at a
 * fixed distance from the middle rather than scaled to the figure — the
 * colour says which way, and the number says how far.
 */
function deltaTone(delta: number | null): string {
  if (delta === null) return "transparent";
  if (delta > 0) return rankColor(88);
  if (delta < 0) return rankColor(12);
  return "var(--readout-muted)";
}

function Pane({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <Window as="section" className="min-w-0 px-[0.9375rem] pb-[0.9375rem] pt-3.5">
      <header className="relative mb-[0.8125rem] flex items-baseline gap-2.5">
        <span className="text-[length:var(--fs-12)] uppercase tracking-[0.12em] text-readout">
          {title}
        </span>
        <span className="ml-auto text-[length:var(--fs-9)] uppercase tracking-[0.18em] text-readout-label">
          {note}
        </span>
      </header>
      <ul className="relative flex flex-col gap-[0.4375rem]">{children}</ul>
    </Window>
  );
}

function StatRow({
  label,
  value,
  lit = false,
  children,
}: {
  label: string;
  value: string;
  lit?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-baseline gap-2.5 text-[length:var(--fs-13)] text-readout-line">
      <span className="min-w-0 flex-1 truncate text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-readout-label">
        {label}
      </span>
      <span className={`shrink-0 tabular-nums ${lit ? "text-readout" : ""}`}>{value}</span>
      {children}
    </li>
  );
}

/**
 * One chip per (criterion, window) pair: how close that pair read, the
 * figure the window actually read off the comp, the window's tag, and the
 * weight the pair carried. An unreadable pair — a null on either side — draws
 * no bars and an em dash, which is the distance's own rule made visible.
 */
function Chip({ comp, pair }: { comp: CompMatch; pair: CompPair }) {
  const criterion = criterionById(pair.criterion);
  const reading = comp.pairs[pairKey(pair.criterion, pair.window)];
  const gap = reading?.gap ?? null;
  const bars = closenessBars(gap);
  const litTone =
    gap === null ? "transparent" : gap < 0.3 ? rankColor(92) : gap < 0.7 ? rankColor(60) : rankColor(24);
  const off = "color-mix(in srgb, var(--foreground) 14%, transparent)";
  // The pair's own counts rather than the row's length: a two-year window with
  // a value in one of its two seasons is `1 of 2 yr`, and calling it `2 yr`
  // would say the average is twice as well founded as it is.
  const tag = observationTag(
    isWindowed(criterion),
    pair.window,
    { used: reading?.used ?? null, of: reading?.of ?? 1 },
    windowById(pair.window).tag,
  );

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/[0.04] py-[0.1875rem] pl-[0.4375rem] pr-2 text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-foreground/[0.72]">
      <span aria-hidden className="inline-flex gap-px">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className="h-[9px] w-[3px] rounded-[1px]"
            style={{ background: bars >= n ? litTone : off }}
          />
        ))}
      </span>
      {criterion.short}
      <span className="tabular-nums text-foreground/95">
        {reading?.read === null || reading?.read === undefined
          ? "—"
          : criterionValue(pair.criterion, reading.read)}
      </span>
      {tag && <span className={LIT}>{tag}</span>}
      <span className="tabular-nums text-foreground/60">{weightLabel(pair.weight)}</span>
    </span>
  );
}
