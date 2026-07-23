import type { ManagerLeague } from "../types";

export function LeagueCard({ league }: { league: ManagerLeague }) {
  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20 hover:bg-white/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{league.name}</h3>
        </div>
        <StatusBadge status={league.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {league.record && (
          <span className="rounded-md bg-white/5 px-2 py-0.5 text-sm font-medium tabular-nums text-white/80">
            {league.record.wins}-{league.record.losses}-{league.record.ties}
          </span>
        )}
        <Stat value={league.total_rosters} label="teams" />
      </div>
    </li>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="rounded-md bg-white/5 px-2 py-0.5 text-sm text-white/55">
      <span className="font-semibold tabular-nums text-white/85">
        {value.toLocaleString()}
      </span>{" "}
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "in_season"
      ? "border-active/40 text-active"
      : status === "drafting" || status === "pre_draft"
        ? "border-amber-400/40 text-amber-300"
        : "border-white/15 text-white/45";
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs uppercase tracking-wide ${tone}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
