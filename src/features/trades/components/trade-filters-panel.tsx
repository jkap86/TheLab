"use client";

import { useMemo } from "react";

import type { UserInfo } from "@/shared/contract";

import {
  DEFAULT_TRADE_FILTERS,
  TRADE_CIRCLES,
  TRADE_RANGE_PRESETS,
  pickLabel,
  tradeRangeBounds,
} from "../filters";
import type {
  TradeCircle,
  TradeFilters,
  TradeOption,
  TradeRangePreset,
} from "../filters";
import { useTradeFacets } from "../hooks/use-trade-facets";
import type { LeagueScope } from "../trade-query";
import type { PlayerSummary, TradeManager } from "../types";
import { OptionPicker } from "./option-picker";

/**
 * The inside of the filters ledge — the window, the match mode and the three
 * facet lists.
 *
 * **It is a separate module because it is what the split is for.** The ledge is
 * closed on arrival, so this markup, the option picker under it and the facets
 * query behind that are all off the first-paint bundle; the trigger and the
 * summary that say what is set stay static, since those are what a reader who
 * never opens it still needs. Same division the two dialogs were split on, for
 * the same reason.
 *
 * **Mounting is the gate.** The old dialog passed a null request while it was
 * closed to keep a closed control from costing a season-wide aggregate; this
 * only exists while it is open, so the request is unconditional and the gate is
 * the mount. Closing unmounts it and cancels anything in flight, and the ten
 * minute stale time means reopening is served from cache — which is the common
 * gesture.
 *
 * **It commits live, with no draft and no Apply**, which is the whole difference
 * between a ledge and the dialog it replaces. The rule the league filters hold a
 * draft for — a count can't be read while the list behind it moves — does not
 * reach here, because the menus are counted *without* the selection
 * (`DEFAULT_TRADE_FILTERS` below): pressing a checkbox cannot move the number
 * beside it. What can move them is the window, and a window change genuinely
 * changing the population is the answer a reader wants rather than a hazard to
 * protect them from.
 */
export function TradeFiltersPanel({
  filters,
  onChange,
  season,
  scope,
  account,
  players,
  managers,
  today,
}: {
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
  season: string;
  /** The league narrowing in force — these options are counted over it. */
  scope: LeagueScope;
  /**
   * The reader's stored account, or null. The circle is the only control here
   * that needs one, and with none it is offered as disabled keys that say why
   * rather than being hidden — a filter nobody can see is one nobody knows they
   * could have.
   */
  account: UserInfo | null;
  /** Names the board already resolved; the facets bring their own for the rest. */
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  /** `YYYY-MM-DD`, so the relative presets resolve without a clock in here. */
  today: string;
}) {
  const bounds = useMemo(
    () => tradeRangeBounds(filters.range, today),
    [filters.range, today],
  );

  // The selection is stripped from the key: these counts are taken without it,
  // so a checkbox that moved the key would re-run a grouped aggregate over the
  // season for an answer that cannot have changed. The window is not stripped,
  // because it is a fact about the population being counted — and neither is the
  // **circle**, for the same reason: it says which trades are on this board at
  // all, so menus counted without it would offer managers and players the reader
  // cannot reach.
  const user = account?.user_id ?? null;
  const circle = filters.circle;
  const request = useMemo(
    () => ({
      season,
      scope,
      filters: { ...DEFAULT_TRADE_FILTERS, circle },
      bounds,
      user,
    }),
    [season, scope, bounds, circle, user],
  );

  const { data: facets, loading } = useTradeFacets(request);
  const names = facets?.names;

  const managerOptions = useMemo(
    () =>
      toOptions(facets?.managers, (id) => ({
        label:
          names?.managers[id]?.display_name || managers[id]?.display_name || id,
      })),
    [facets?.managers, names, managers],
  );
  const playerOptions = useMemo(
    () =>
      toOptions(facets?.players, (id) => {
        const player = names?.players[id] ?? players[id];
        return {
          label: player?.name ?? id,
          note: [player?.position, player?.team].filter(Boolean).join(" · "),
        };
      }),
    [facets?.players, names, players],
  );
  const pickOptions = useMemo(
    // A pick's label is a pure formatting of its own token, which is why the
    // route doesn't send one — it would be a string derivable from the one
    // beside it.
    () => toOptions(facets?.picks, (token) => ({ label: pickLabel(token) })),
    [facets?.picks],
  );

  const setPreset = (preset: TradeRangePreset) =>
    onChange({ ...filters, range: { ...filters.range, preset } });

  return (
    <div className="mt-3 flex flex-col gap-4 border-t border-foreground/10 pt-3">
      {/* The population, on a line of its own above the three groups that cut
          it down. It leads because that is the order the panel is read in —
          which trades are on this board at all, then which of those — and it
          keeps its own line because the caption under it belongs to this group
          and would break the `items-end` row below. */}
      <Group label="Scope">
        <div className="flex flex-wrap gap-1.5">
          {TRADE_CIRCLES.map((option) => (
            <Key
              key={option.value}
              selected={filters.circle === option.value}
              // Every circle but the widest is drawn around an account, so
              // without one there is nothing to draw. Disabled rather than
              // absent: what it takes to switch it on is a sentence, and hiding
              // the control hides the sentence too.
              disabled={option.value !== "all" && account === null}
              onClick={() => onChange({ ...filters, circle: option.value })}
            >
              {option.label}
            </Key>
          ))}
        </div>
        {/* One caption for the group rather than a note under each key: the
            labels alone don't separate the two leaguemate readings — one is
            about who was dealing, the other about where the deal happened — and
            four notes at this width is a paragraph where the row should be. */}
        <p className="text-xs text-foreground/45">
          {circleNote(filters.circle, account)}
        </p>
      </Group>

      {/* Three groups, and at this panel's width (the page shell caps at
          `max-w-4xl`) they do not fit on one line — so the order decides what
          wraps. The two chip groups lead because they are what gets pressed;
          the date pair is the rarer, deliberate window and is what drops to a
          second line. */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <Group label="Completed">
          <div className="flex flex-wrap gap-1.5">
            {TRADE_RANGE_PRESETS.map((preset) => (
              <Key
                key={preset.value}
                selected={filters.range.preset === preset.value}
                onClick={() => setPreset(preset.value)}
              >
                {preset.label}
              </Key>
            ))}
          </div>
        </Group>

        <Group label="Match">
          <div className="flex gap-1.5">
            <Key
              selected={filters.match === "all"}
              onClick={() => onChange({ ...filters, match: "all" })}
            >
              All selected
            </Key>
            <Key
              selected={filters.match === "any"}
              onClick={() => onChange({ ...filters, match: "any" })}
            >
              Any selected
            </Key>
          </div>
        </Group>

        <Group label="Between">
          <div className="flex items-center gap-2">
            <DateInput
              label="From"
              value={filters.range.from}
              onChange={(from) =>
                onChange({
                  ...filters,
                  // Typing a date *is* the custom window — there is no mode to
                  // enter first, the same rule the ADP scrubber follows.
                  range: { ...filters.range, preset: "custom", from },
                })
              }
            />
            <span className="text-foreground/30">–</span>
            <DateInput
              label="To"
              value={filters.range.to}
              onChange={(to) =>
                onChange({
                  ...filters,
                  range: { ...filters.range, preset: "custom", to },
                })
              }
            />
          </div>
        </Group>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <OptionPicker
          label="Managers"
          placeholder="Search managers…"
          options={managerOptions}
          selected={filters.managers}
          onChange={(next) => onChange({ ...filters, managers: next })}
          loading={loading}
        />
        <OptionPicker
          label="Players"
          placeholder="Search players…"
          options={playerOptions}
          selected={filters.players}
          onChange={(next) => onChange({ ...filters, players: next })}
          loading={loading}
        />
        <OptionPicker
          label="Picks"
          placeholder="Search picks…"
          options={pickOptions}
          selected={filters.picks}
          onChange={(next) => onChange({ ...filters, picks: next })}
          loading={loading}
        />
      </div>
    </div>
  );
}

/**
 * A facet list as the picker's options, labelled.
 *
 * The counts arrive ordered by count already; the tiebreak on label is applied
 * here because only this side knows what a value is called — a player's name is
 * a row in another table and a pick's is a formatting of its own token.
 */
function toOptions(
  facets: readonly { value: string; count: number }[] | undefined,
  label: (value: string) => { label: string; note?: string },
): TradeOption[] {
  if (!facets) return [];
  return facets
    .map((facet) => ({ ...label(facet.value), ...facet }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-foreground/40">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * A segment key inside the panel — `.lab-chip-sm`, the app's thinner press.
 *
 * Thinner than the `Filters` key that opened the ledge for the reason the
 * league filters' quick-adds are: a control seated inside something is a lesser
 * press than the control that opened it, and a row of full-thickness parts in
 * here would read as competing with it.
 */
function Key({
  selected,
  disabled = false,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        selected
          ? "lab-chip-on lab-chip-sm"
          : disabled
            ? // Flat and unlit, the app bar's rule held to at this size: a part
              // that does nothing when pressed must not look pressable, so it
              // loses its wall rather than only dimming its text.
              "cursor-not-allowed rounded-full text-foreground/25"
            : "lab-chip lab-chip-sm text-foreground/75"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * What the scope keys mean, in one line that follows the selection.
 *
 * Two things it says that the keys cannot. Which of the two leaguemate circles
 * is which — who was *dealing* against where the deal *happened* — and, once one
 * is chosen, *whose* circle it is: the account is stored on the device and may
 * not be the one the reader has in mind.
 */
function circleNote(circle: TradeCircle, account: UserInfo | null): string {
  if (account === null) {
    return "Look your Sleeper account up on the tools page to filter by your own leagues and leaguemates.";
  }
  const who = `@${account.display_name || account.username}`;
  const note = TRADE_CIRCLES.find((c) => c.value === circle)!.note;
  return circle === "all" ? note : `${note} Drawn around ${who}.`;
}

/** A native date input — the platform's calendar, keyboard entry included. */
function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <input
      type="date"
      aria-label={label}
      value={value ?? ""}
      // An emptied input is an *open* end, not today — a window is two
      // independent halves and one of them has to stay expressible.
      onChange={(event) => onChange(event.target.value || null)}
      className="rounded-lg border border-foreground/10 bg-foreground/[0.04] px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-active/45"
    />
  );
}
