"use client";

import { useMemo, useState } from "react";

import { activeTradeFilterCount, tradeRangeLabel } from "../filters";
import type { TradeFilters, TradeOption } from "../filters";
import { OptionPicker } from "../components/option-picker";
import {
  MOCK_MANAGER_OPTIONS,
  MOCK_PICK_OPTIONS,
  MOCK_PLAYER_OPTIONS,
  MOCK_SCOPE_TOTAL,
  MOCK_TOTAL,
} from "./fixtures";
import {
  Caption,
  CountReadout,
  MatchControls,
  Popover,
  SearchField,
  Token,
  Trigger,
  WindowControls,
  useOneOpen,
} from "./parts";

/**
 * Four ways to seat the trade filters on the page instead of behind a modal.
 *
 * Each renders the controls the dialog holds today — the window, the match mode
 * and the three facet lists — and each keeps the two neighbours that are *not*
 * moving: the league filters and the value picker. What varies is only where the
 * controls live and what that costs the board underneath.
 *
 * They share `OptionPicker` unchanged, which is the point of building them in
 * the app rather than as pictures: the list, its search, its counts and its
 * 200-row cap are the shipped component in all four, so the comparison is
 * between arrangements and not between four re-drawings of the same list.
 */

export type VariantProps = {
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
  /** Stand-ins for the two controls that keep their place in every variant. */
  neighbours: React.ReactNode;
};

type FacetKey = "managers" | "players" | "picks";

const FACETS: {
  key: FacetKey;
  label: string;
  placeholder: string;
  options: TradeOption[];
}[] = [
  {
    key: "managers",
    label: "Managers",
    placeholder: "Search managers…",
    options: MOCK_MANAGER_OPTIONS,
  },
  {
    key: "players",
    label: "Players",
    placeholder: "Search players…",
    options: MOCK_PLAYER_OPTIONS,
  },
  {
    key: "picks",
    label: "Picks",
    placeholder: "Search picks…",
    options: MOCK_PICK_OPTIONS,
  },
];

/* ------------------------------------------------------------------ A ---- */

/**
 * **A · Control bar.** One row of keys where the page heading was, each opening
 * its own list over the board.
 *
 * The row's height is the row's height whatever is open, because a popover
 * floats rather than expanding into the flow — the rule the league filters'
 * segment rows already keep, applied to a page instead of a dialog. It is one
 * press from anywhere to any filter, which is the thing the modal costs two of.
 *
 * **Only the filters that are narrowing get a key of their own; the quiet ones
 * sit behind one `Filters` key badged with how many there are.** That is the ADP
 * drawer's rule, and it is load-bearing rather than decorative: the first
 * build of this laid all seven out unconditionally and wrapped to two rows at
 * 1360px, which is the whole of what the layout was buying. A filter already set
 * stays a live key, so changing one is the single press it always was — the tray
 * is only the way to a filter that is *off*, which is the case the row would
 * otherwise be spending its width on.
 */
export function VariantA({ filters, onChange, neighbours }: VariantProps) {
  const menu = useOneOpen<FacetKey | "when" | "more">();

  // A filter is on the row when it is narrowing; the rest are in the tray. The
  // window counts as narrowing whenever it isn't "all time".
  const shown = FACETS.filter((facet) => filters[facet.key].length > 0);
  const quiet = FACETS.filter((facet) => filters[facet.key].length === 0);
  const windowed = filters.range.preset !== "all";
  const trayCount = quiet.length + (windowed ? 0 : 1) + 1; // + the match mode

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <CountReadout total={MOCK_TOTAL} scopeTotal={MOCK_SCOPE_TOTAL} />

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {windowed && (
          <div className="relative">
            <Trigger
              label={tradeRangeLabel(filters.range)}
              lit
              expanded={menu.open === "when"}
              onClick={() => menu.toggle("when")}
            />
            <Popover open={menu.open === "when"} onClose={menu.close}>
              <div className="flex flex-col gap-2.5">
                <Caption>Completed</Caption>
                <WindowControls filters={filters} onChange={onChange} />
              </div>
            </Popover>
          </div>
        )}

        {shown.map((facet) => (
          <div key={facet.key} className="relative">
            <Trigger
              label={facet.label}
              count={filters[facet.key].length}
              lit
              expanded={menu.open === facet.key}
              onClick={() => menu.toggle(facet.key)}
            />
            <Popover open={menu.open === facet.key} onClose={menu.close} align="right">
              <OptionPicker
                label={facet.label}
                placeholder={facet.placeholder}
                options={facet.options}
                selected={filters[facet.key]}
                onChange={(next) => onChange({ ...filters, [facet.key]: next })}
              />
            </Popover>
          </div>
        ))}

        <div className="relative">
          <Trigger
            label="Filters"
            count={trayCount}
            expanded={menu.open === "more"}
            onClick={() => menu.toggle("more")}
          />
          {/* The tray holds *every* filter, not just the quiet ones, so the set
              doesn't reshuffle as it is used — the same reason the ADP drawer's
              does. The summary keys above step aside from nothing. */}
          <Popover open={menu.open === "more"} onClose={menu.close} align="right" width="w-80">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2.5">
                <Caption>Completed</Caption>
                <WindowControls filters={filters} onChange={onChange} />
              </div>
              <div className="flex flex-col gap-2.5">
                <Caption>Match</Caption>
                <MatchControls filters={filters} onChange={onChange} />
              </div>
              {FACETS.map((facet) => (
                <OptionPicker
                  key={facet.key}
                  label={facet.label}
                  placeholder={facet.placeholder}
                  options={facet.options}
                  selected={filters[facet.key]}
                  onChange={(next) => onChange({ ...filters, [facet.key]: next })}
                />
              ))}
            </div>
          </Popover>
        </div>

        <span aria-hidden="true" className="h-6 w-px bg-foreground/10" />
        {neighbours}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ B ---- */

/**
 * **B · Token field.** One search over managers, players and picks together,
 * with each choice landing in the field as a token.
 *
 * A reader arrives with a name, not with a category — "what did Buscemi25 give
 * up for Brian Thomas" names two things from two different lists — so the field
 * searches all three and groups the results. The window and the match mode stay
 * keys beside it, because neither is something anyone types.
 *
 * What it trades away is the *browse*: the counts beside each option are what
 * say who actually deals and which player has moved more than once, and a search
 * box hides them until you already know the name.
 */
export function VariantB({ filters, onChange, neighbours }: VariantProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FACETS.map((facet) => ({
      ...facet,
      matches: facet.options
        .filter(
          (option) =>
            !filters[facet.key].includes(option.value) &&
            (!q || option.label.toLowerCase().includes(q)),
        )
        .slice(0, 4),
    })).filter((group) => group.matches.length > 0);
  }, [query, filters]);

  const tokens = FACETS.flatMap((facet) =>
    filters[facet.key].map((value) => ({
      facet,
      value,
      label:
        facet.options.find((option) => option.value === value)?.label ?? value,
    })),
  );

  const add = (key: FacetKey, value: string) => {
    onChange({ ...filters, [key]: [...filters[key], value] });
    setQuery("");
  };
  const remove = (key: FacetKey, value: string) =>
    onChange({ ...filters, [key]: filters[key].filter((v) => v !== value) });

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="relative min-w-[18rem] flex-1">
        <div className="lab-readout flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
          <span aria-hidden="true" className="text-sm text-foreground/30">
            ⌕
          </span>
          {tokens.map((token) => (
            <Token
              key={`${token.facet.key}-${token.value}`}
              kind={TOKEN_KIND[token.facet.key]}
              label={token.label}
              onRemove={() => remove(token.facet.key, token.value)}
            />
          ))}
          <SearchField
            value={query}
            onChange={setQuery}
            onFocus={() => setOpen(true)}
            placeholder="Add a manager, player or pick…"
          />
        </div>

        <Popover open={open} onClose={() => setOpen(false)} width="w-full">
          <div className="flex flex-col gap-3">
            {groups.length === 0 && (
              <p className="px-1 py-2 text-sm text-foreground/40">No matches</p>
            )}
            {groups.map((group) => (
              <div key={group.key} className="flex flex-col gap-1">
                <Caption>{group.label}</Caption>
                {group.matches.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => add(group.key, option.value)}
                    className="flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/75 transition-colors hover:bg-foreground/5 hover:text-foreground"
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                    {option.note && (
                      <span className="shrink-0 text-xs text-foreground/40">
                        {option.note}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-foreground/30">
                      {option.count}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Popover>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <MatchTrigger filters={filters} onChange={onChange} />
        <WindowTrigger filters={filters} onChange={onChange} />
        {neighbours}
        <CountReadout total={MOCK_TOTAL} scopeTotal={MOCK_SCOPE_TOTAL} />
      </div>
    </div>
  );
}

const TOKEN_KIND: Record<FacetKey, string> = {
  managers: "mgr",
  players: "plr",
  picks: "pick",
};

/* ------------------------------------------------------------------ C ---- */

/**
 * **C · Expanding ledge.** The modal's own panel, seated on the page under a
 * one-line summary and closed by default.
 *
 * The smallest change of the four — the inside is the dialog's three columns
 * unedited — and the only one that still hides. Opening pushes the board down
 * ~256px, which the virtualizer re-measures and the reader loses their place in;
 * closed it is the tightest line on the page.
 */
export function VariantC({ filters, onChange, neighbours }: VariantProps) {
  const [open, setOpen] = useState(false);
  const active = activeTradeFilterCount(filters);

  return (
    <div className="lab-trough mb-4 rounded-2xl p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Trigger
          label="Filters"
          count={active}
          lit={active > 0}
          expanded={open}
          onClick={() => setOpen((was) => !was)}
        />
        <span className="min-w-0 truncate text-xs text-foreground/50">
          {summarise(filters)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <CountReadout total={MOCK_TOTAL} scopeTotal={MOCK_SCOPE_TOTAL} />
          {neighbours}
        </div>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-4 border-t border-foreground/10 pt-3">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div className="flex flex-col gap-2">
              <Caption>Completed</Caption>
              <WindowControls filters={filters} onChange={onChange} />
            </div>
            <div className="flex flex-col gap-2">
              <Caption>Match</Caption>
              <MatchControls filters={filters} onChange={onChange} />
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            {FACETS.map((facet) => (
              <OptionPicker
                key={facet.key}
                label={facet.label}
                placeholder={facet.placeholder}
                options={facet.options}
                selected={filters[facet.key]}
                onChange={(next) => onChange({ ...filters, [facet.key]: next })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ D ---- */

/**
 * **D · Side rail.** A 232px column beside the board holding every filter open.
 *
 * It spends the one dimension the page has to spare: a trade card is short
 * asset lines in two columns, so it reads at 78% of the width and the list gains
 * nothing from the last 200px. Nothing is hidden and nothing costs a press —
 * change a filter and watch the count above it move, which is the ADP drawer's
 * whole argument without a drawer.
 *
 * The cost is that a phone has no rail, so below the breakpoint it has to become
 * one of the other three.
 */
export function VariantD({
  filters,
  onChange,
  neighbours,
  children,
}: VariantProps & { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* 264px rather than the 232 this opened at: at the narrower width a name
          in the players list truncated (`Brian Tho…`), and recognising the
          person is the whole point of the row — the same failure the expanded
          league panel's name track was widened for. */}
      <aside className="lab-trough flex shrink-0 flex-col gap-4 rounded-2xl p-3 lg:sticky lg:top-[calc(var(--site-header-h)+0.75rem)] lg:w-[264px]">
        <div className="lab-readout rounded-xl px-3 py-2">
          <CountReadout total={MOCK_TOTAL} scopeTotal={MOCK_SCOPE_TOTAL} stacked />
        </div>

        <div className="flex flex-col gap-2">
          <Caption>Completed</Caption>
          <WindowControls filters={filters} onChange={onChange} compact />
        </div>

        <div className="flex flex-col gap-2">
          <Caption>Match</Caption>
          <MatchControls filters={filters} onChange={onChange} />
        </div>

        {FACETS.map((facet) => (
          <OptionPicker
            key={facet.key}
            label={facet.label}
            placeholder="Search…"
            options={facet.options}
            selected={filters[facet.key]}
            onChange={(next) => onChange({ ...filters, [facet.key]: next })}
          />
        ))}
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mb-3 flex justify-end gap-2">{neighbours}</div>
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shared -- */

function WindowTrigger({
  filters,
  onChange,
}: {
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Trigger
        label={tradeRangeLabel(filters.range)}
        lit={filters.range.preset !== "all"}
        expanded={open}
        onClick={() => setOpen((was) => !was)}
      />
      <Popover open={open} onClose={() => setOpen(false)} align="right">
        <div className="flex flex-col gap-2.5">
          <Caption>Completed</Caption>
          <WindowControls filters={filters} onChange={onChange} />
        </div>
      </Popover>
    </div>
  );
}

function MatchTrigger({
  filters,
  onChange,
}: {
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen =
    filters.managers.length + filters.players.length + filters.picks.length;
  return (
    <div className="relative">
      <Trigger
        label={chosen > 0 ? `${filters.match} of ${chosen}` : `Match: ${filters.match}`}
        expanded={open}
        onClick={() => setOpen((was) => !was)}
      />
      <Popover open={open} onClose={() => setOpen(false)} align="right" width="w-56">
        <div className="flex flex-col gap-2.5">
          <Caption>Match</Caption>
          <MatchControls filters={filters} onChange={onChange} />
        </div>
      </Popover>
    </div>
  );
}

/** The selection in words — what the deleted scope line used to carry. */
function summarise(filters: TradeFilters): string {
  const chosen = (
    [
      [filters.managers.length, "manager"],
      [filters.players.length, "player"],
      [filters.picks.length, "pick"],
    ] as const
  )
    .filter(([count]) => count > 0)
    .map(([count, noun]) => `${count} ${noun}${count === 1 ? "" : "s"}`);

  const window = tradeRangeLabel(filters.range).toLowerCase();
  if (chosen.length === 0) return window;
  return `${window} · ${filters.match} of ${chosen.join(", ")}`;
}
