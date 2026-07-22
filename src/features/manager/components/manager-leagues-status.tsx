import type { SyncProgress } from "../types";

export function LoadingState({
  searched,
  progress,
}: {
  searched: string;
  progress: SyncProgress | null;
}) {
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.loaded / progress.total) * 100)
      : null;

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 text-center">
      <p className="text-lg text-white/70">
        Loading leagues for{" "}
        <span className="font-semibold text-white">{searched}</span>…
      </p>
      <div className="h-2 w-64 max-w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full bg-active transition-[width] duration-300 ${
            pct === null ? "w-1/3 animate-pulse" : ""
          }`}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className="text-sm text-white/45">
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
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-10 text-center text-white/55">
      No {season} leagues found for this manager.
    </div>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center text-red-200">
      {message}
    </div>
  );
}
