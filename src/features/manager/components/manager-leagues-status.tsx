import type { SyncProgress } from "../types";

export function LoadingState({
  searched,
  season,
  progress,
}: {
  searched: string;
  /**
   * The season being loaded.
   *
   * Named because this screen is what a step back through the header's season
   * stepper lands on when that season has never been synced for this manager: a
   * full foreground fan-out, on the same screen a first visit gets. Without it
   * the two are indistinguishable, and a reader who has just pressed `‹` has no
   * confirmation the press did anything.
   */
  season: string;
  progress: SyncProgress | null;
}) {
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.loaded / progress.total) * 100)
      : null;

  return (
    // The whole cold load is one status: it is what stands in for the page, so a
    // reader who arrives here has nothing else to be told. The bar under it is a
    // real progress bar rather than a decorated div, which is what lets "41 of
    // 121" be reported as a *position* and not only as a sentence.
    <div
      role="status"
      className="flex min-h-[50vh] flex-col items-center justify-center gap-5 text-center"
    >
      <p className="text-lg text-foreground/70">
        Loading <span className="tabular-nums">{season}</span> leagues for{" "}
        <span className="font-semibold text-foreground">{searched}</span>…
      </p>
      <div
        role="progressbar"
        aria-label="Leagues synced"
        // An indeterminate bar leaves the value off entirely, which is what the
        // pulsing third of a track already says visually.
        aria-valuemin={pct === null ? undefined : 0}
        aria-valuemax={pct === null ? undefined : 100}
        aria-valuenow={pct ?? undefined}
        className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-foreground/10"
      >
        <div
          className={`h-full rounded-full bg-active transition-[width] duration-300 ${
            pct === null ? "w-1/3 animate-pulse" : ""
          }`}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className="text-sm text-foreground/45">
        {pct === null
          ? "Syncing from Sleeper…"
          : `${progress!.loaded} / ${progress!.total} leagues${
              progress!.failed ? ` · ${progress!.failed} failed` : ""
            }`}
      </p>
    </div>
  );
}

export function EmptyState({ season }: { season: string }) {
  return (
    <div className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-10 text-center text-foreground/55">
      No {season} leagues found for this manager.
    </div>
  );
}

// The failed-read card went to `features/shared/ui/panel-message` with the
// shares sheet that draws it — the lineup checker opens the same sheet — and is
// re-exported here for this feature's own consumers.
export { ErrorCard } from "@/features/shared/ui/panel-message";
