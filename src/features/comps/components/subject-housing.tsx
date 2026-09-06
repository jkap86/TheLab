"use client";

import {
  CONSOLE_CARD,
  CONSOLE_KEY,
  CardPlateRow,
  LeaguePlate,
  PlateDivider,
  PlateField,
  ReadingPlate,
} from "@/features/shared";
import type { CompSubject } from "@/shared/contract";
import { K_MAX, K_MIN } from "@/shared/comps";

import { draftLabel, num } from "../helpers/format";
import { CAPTION, LIT, Rail, ToggleKey, Window } from "./controls";

/** The most matches the list shows; the rest are narrowed to. */
const MATCHES_SHOWN = 8;

/**
 * The subject housing: who is being comped, as he stands, and the pool the
 * comps are drawn from.
 *
 * The plates are the console card's own — `LeaguePlate` with no avatar draws
 * exactly the lit-initial lamp the design asks for, and the reading plate
 * opposite carries the three facts the handoff puts there, with the KTC
 * figure alone lit: it is the one *market* figure on the plate, and the glow
 * is what says so.
 *
 * **The readouts show the subject's last completed line, always — never a
 * windowed figure.** Windows are per criterion, so no single window could
 * label this grid; what each criterion actually read is on the comp card's
 * chips, tagged with its window.
 */
export function SubjectHousing({
  subject,
  subjectSeason,
  players,
  playersError,
  query,
  onQuery,
  browsing,
  onPick,
  onClear,
  posLock,
  onPosLock,
  excludeOwn,
  onExcludeOwn,
  seasons,
  from,
  to,
  onFrom,
  onTo,
  k,
  onK,
  pool,
}: {
  subject: CompSubject | null;
  subjectSeason: number | null;
  players: readonly CompSubject[];
  playersError: string | null;
  query: string;
  onQuery: (query: string) => void;
  browsing: boolean;
  onPick: (playerId: string) => void;
  onClear: () => void;
  posLock: boolean;
  onPosLock: () => void;
  excludeOwn: boolean;
  onExcludeOwn: () => void;
  /** Every season the corpus offers, ascending. */
  seasons: readonly number[];
  from: number | null;
  to: number | null;
  onFrom: (season: number) => void;
  onTo: (season: number) => void;
  k: number;
  onK: (k: number) => void;
  pool: { eligible: number; total: number } | null;
}) {
  const needle = query.trim().toLowerCase();
  const matched = needle
    ? players.filter((p) => p.name.toLowerCase().includes(needle))
    : players;
  const shown = matched.slice(0, MATCHES_SHOWN);
  const showMatches = browsing || subject === null;

  return (
    <section className={`${CONSOLE_CARD} mt-9 font-mono`}>
      <CardPlateRow>
        <LeaguePlate
          name={subject?.name ?? "No player selected"}
          avatarUrl={null}
          size="lg"
        />
        <ReadingPlate>
          {/* Below `md` the plate keeps KTC alone, on the manager plate's
              own precedent of losing a field at a phone's width: a
              three-field plate at 390 left the name plate opposite its lamp
              and nothing else, at two fields the name was five characters,
              and at 640 — where `PlateField` steps its type up — the full
              plate still clipped it to eight. The two seasons are already
              stated in the page header; the price is the one figure stated
              nowhere else. Measured: the name is whole at 390 and 768. */}
          <span className="hidden md:contents">
            <PlateField label="Entering">{subjectSeason ?? "—"}</PlateField>
            <PlateDivider />
            <PlateField label="Last">
              {subject?.last_season ?? (subjectSeason ? subjectSeason - 1 : "—")}
            </PlateField>
            <PlateDivider />
          </span>
          <PlateField label="KTC">
            <span className={LIT}>
              {subject?.ktc === null || subject?.ktc === undefined ? "—" : num(subject.ktc)}
            </span>
          </PlateField>
        </ReadingPlate>
      </CardPlateRow>

      <div className="relative flex flex-wrap items-center gap-2.5">
        <Window className="min-w-[12rem] flex-[1_1_16rem]">
          <input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search players"
            aria-label="Search players"
            autoComplete="off"
            className="relative w-full border-0 bg-transparent px-[0.9375rem] py-3 font-mono text-[length:var(--fs-13)] tracking-[0.04em] text-readout-line outline-none placeholder:text-readout-muted [&::-webkit-search-cancel-button]:[-webkit-appearance:none]"
          />
        </Window>
        <button type="button" onClick={onClear} className={CONSOLE_KEY}>
          Clear
        </button>
      </div>

      {showMatches && (
        <>
          <ul className="relative mt-3 flex max-h-[17rem] flex-col gap-0.5 overflow-y-auto">
            {shown.map((p) => {
              const picked = subject?.player_id === p.player_id;
              return (
                <li key={p.player_id}>
                  <button
                    type="button"
                    onClick={() => onPick(p.player_id)}
                    aria-pressed={picked}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-mono text-[length:var(--fs-13)] hover:bg-foreground/[0.05] ${
                      picked ? "text-active" : "text-foreground/80"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {p.name}
                      <span className="ml-1.5 text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-foreground/60">
                        {p.position} · {p.season}
                      </span>
                    </span>
                    <span className="shrink-0 text-[length:var(--fs-11)] tabular-nums text-foreground/60">
                      {num(p.line.ppg, 1)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="relative mt-2 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-foreground/60">
            {playersError
              ? playersError
              : players.length === 0
                ? "Loading players…"
                : matched.length === 0
                  ? "No player by that name"
                  : matched.length > shown.length
                    ? `${matched.length - shown.length} more — narrow with the search field`
                    : `${matched.length} players`}
          </p>
        </>
      )}

      {subject && <SubjectReadouts subject={subject} />}

      <div className="relative mt-4 flex flex-wrap items-center gap-2.5 border-t border-foreground/8 pt-3.5">
        <span className={CAPTION}>Pool</span>
        <ToggleKey on={posLock} onClick={onPosLock}>
          Position lock
        </ToggleKey>
        <ToggleKey on={excludeOwn} onClick={onExcludeOwn}>
          Exclude own seasons
        </ToggleKey>
        <Groove />
        <label className="inline-flex items-center gap-[0.4375rem]">
          <span className={CAPTION}>Seasons</span>
          <SeasonSelect
            label="Season from"
            value={from}
            seasons={seasons}
            onChange={onFrom}
          />
          <span aria-hidden className="text-[length:var(--fs-11)] text-foreground/45">
            –
          </span>
          <SeasonSelect label="Season to" value={to} seasons={seasons} onChange={onTo} />
        </label>
        <Groove />
        <span className="inline-flex items-center gap-2">
          <span className={CAPTION}>Comps</span>
          <Rail
            value={k}
            min={K_MIN}
            max={K_MAX}
            step={1}
            label="Comps returned"
            onChange={onK}
            className="w-[6.5rem]"
          />
          <span className={`min-w-[1.375rem] text-right text-[length:var(--fs-13)] tabular-nums ${LIT}`}>
            {k}
          </span>
        </span>
        <span className="ml-auto inline-flex items-baseline gap-[0.4375rem]">
          <span className={CAPTION}>Eligible</span>
          <span className={`text-[length:var(--fs-14)] tabular-nums ${LIT}`}>
            {pool ? `${pool.eligible} of ${pool.total}` : "—"}
          </span>
        </span>
      </div>
    </section>
  );
}

/**
 * The nine lit windows: the subject's last line. Draft renders `UDFA` at or
 * past the mark, and a running back's yardage window is his rushing.
 */
function SubjectReadouts({ subject }: { subject: CompSubject }) {
  const rb = subject.position === "RB";
  const cells: [string, string][] = [
    ["Age", String(subject.age)],
    ["Exp", `${subject.exp} yr`],
    ["Draft", draftLabel(subject.draft)],
    ["PPG", num(subject.line.ppg, 1)],
    [rb ? "Rush yd" : "Rec yd", num(rb ? subject.line.rush : subject.line.recyd)],
    ["Tgt sh", subject.line.tgtsh === null ? "—" : `${num(subject.line.tgtsh)}%`],
    ["YPRR", subject.line.yprr === null ? "—" : subject.line.yprr.toFixed(2)],
    ["Snap", subject.line.snap === null ? "—" : `${num(subject.line.snap)}%`],
    ["GP", String(subject.line.gp)],
  ];
  return (
    <div className="relative mt-4 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(6.5rem,1fr))]">
      {cells.map(([label, value]) => (
        <Window key={label} className="px-[0.6875rem] pb-[0.5625rem] pt-2">
          <p className="relative text-[length:var(--fs-9)] uppercase tracking-[0.18em] text-readout-label">
            {label}
          </p>
          <p className={`relative mt-[0.1875rem] text-[length:var(--fs-16)] tabular-nums ${LIT}`}>
            {value}
          </p>
        </Window>
      ))}
    </div>
  );
}

function SeasonSelect({
  label,
  value,
  seasons,
  onChange,
}: {
  label: string;
  value: number | null;
  seasons: readonly number[];
  onChange: (season: number) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      disabled={seasons.length === 0}
      onChange={(event) => onChange(Number(event.target.value))}
      className="rounded-[0.625rem] border border-foreground/10 bg-[image:var(--key-bg)] px-[0.4375rem] py-1.5 font-mono text-[length:var(--fs-11)] tracking-[0.08em] text-foreground/85 shadow-[var(--key-shadow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
    >
      {seasons.length === 0 && <option value="">—</option>}
      {seasons.map((season) => (
        <option key={season} value={season}>
          {season}
        </option>
      ))}
    </select>
  );
}

/** The milled cut between the strip's groups. */
function Groove() {
  return (
    <span
      aria-hidden
      className="w-px self-stretch bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
    />
  );
}
