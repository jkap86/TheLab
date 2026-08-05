import { RollingNumber } from "../rolling-number";
import { KeyChip } from "./key-chip";

/**
 * The drawer's identity line: what this is, which season's market it describes,
 * how many drafts that came to, and the way out.
 *
 * One line rather than the two it was — a header stating a count the trigger
 * already carried, over a labelled row of season keys, was two lines saying what
 * fits on one. The pinned block below it is the rest of the controls.
 */
export function AdpDrawerHeader({
  seasons,
  season,
  draftCount,
  onSeasonChange,
  onClose,
}: {
  /** The seasons on offer, `"all"` last — see `seasonOptions`. */
  seasons: readonly string[];
  season: string;
  /** Null until the first load lands. */
  draftCount: number | null;
  onSeasonChange: (season: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <h2 className="font-display text-[0.8rem] font-bold tracking-[0.14em] text-active/85">
        ADP
      </h2>
      <div className="flex gap-1">
        {seasons.map((s) => (
          <KeyChip key={s} on={season === s} onClick={() => onSeasonChange(s)}>
            {s === "all" ? "All" : s}
          </KeyChip>
        ))}
      </div>
      <span className="lab-readout ml-auto flex items-baseline gap-1.5 rounded-[5px] px-2.5 py-[3px]">
        {/* The count rolls to its new value rather than swapping — it is
            the needle the window control moves, and a digit that travels
            is what says the two are connected. */}
        <span className="font-display text-[0.8rem] font-bold tabular-nums text-active">
          <RollingNumber
            value={draftCount === null ? "—" : draftCount.toLocaleString()}
          />
        </span>
        <span className="text-[0.55rem] font-semibold uppercase tracking-[0.16em] text-foreground/40">
          {draftCount === 1 ? "draft" : "drafts"}
        </span>
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-foreground/10 text-foreground/50 transition-colors hover:border-foreground/25 hover:text-foreground"
      >
        ✕
      </button>
    </div>
  );
}
