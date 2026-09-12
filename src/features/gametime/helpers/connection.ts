/**
 * What the gametime page is *doing*, as one word, and what its readout says.
 *
 * Pure and under Node's own runner, on `./live-record`'s terms: the page's one
 * status pill is read at a glance by somebody deciding whether the numbers in
 * front of them are current, and every wrong reading of it is a sentence that
 * renders perfectly and misleads.
 *
 * **It exists because two booleans could not carry seven answers.** The pill
 * was drawn from `connected` and `stale` alone, so every state that was not an
 * open stream fell through to `Connecting…` — including the three where the
 * page is deliberately *not* connecting: an account with no leagues (the hook
 * never opens a stream at all), a season with no week left to follow (the
 * server says so and closes), and a stream that has given up for good. A page
 * saying it is connecting while nothing is connecting is the one reading a
 * status pill must never give.
 */

/** Where the stream is. */
export type GametimeConnection =
  /** Not connecting, on purpose — there is nothing yet to connect for. */
  | "idle"
  /** A stream is opening and has not answered yet. */
  | "connecting"
  /** Open and answering. */
  | "live"
  /** Dropped, and being retried — an answer may still be on screen. */
  | "reconnecting"
  /**
   * The stream could not be kept, and a plain snapshot is standing in for it.
   * The numbers are real and they are not moving. See `useGametime`.
   */
  | "snapshot"
  /** The season has no week left to follow. Terminal, and not a failure. */
  | "complete"
  /** Nothing to show and nothing left to try. */
  | "failed";

/** Where the account's league list is — the page cannot connect without one. */
export type LeagueListState = "loading" | "none" | "ready";

export type GametimeReadout = {
  text: string;
  /** The stream is answering: the readout is lit rather than dimmed. */
  lit: boolean;
  /** A game is running behind an open stream: the lamp pulses. */
  pulse: boolean;
  /**
   * The next kickoff, epoch ms, that the page's countdown counts to — set on
   * the waiting reading alone, and only where a kickoff is known.
   *
   * It rides beside the pill's words rather than replacing them: the pill
   * keeps `Waiting · 14 games to come`, which is what its live region
   * announces, and the countdown is a panel of its own under it
   * (`KickoffCountdown`) that ticks every second out of the accessibility
   * tree — a live region whose text changed every second would be read aloud
   * every second.
   */
  countdownTo: number | null;
};

type Games = { pre: number; live: number; final: number };

/** `3 in progress`, `12 to come`, `final`, `no games` — the board in three words. */
function gamesPhrase(games: Games): string {
  if (games.live > 0) return `${games.live} in progress`;
  if (games.pre > 0) return `${games.pre} to come`;
  if (games.final > 0) return "final";
  return "no games";
}

/** Every reading but the waiting one counts down to nothing. */
const reading = (text: string, lit: boolean, pulse = false): GametimeReadout => ({
  text,
  lit,
  pulse,
  countdownTo: null,
});

/**
 * What the pill beside the week stepper reads.
 *
 * The order is the point: **a terminal or deliberate state answers before any
 * connection state does**, because those are the ones a connection word would
 * misdescribe. Only once the page is genuinely following a week does the
 * reading become the scoreboard's — which is the one thing a reader looking at
 * a quiet page actually needs told, since a page with nothing moving on it is
 * the same picture whether the NFL week has not started or the stream is dead.
 *
 * A degraded feed is named here as well as in the notes above the grid: the
 * notes say which feed and what it costs, and this says that the reading is
 * affected at all, which is what survives a reader who has scrolled past them.
 *
 * **Only the waiting reading counts down**, and only on an open, healthy
 * stream. A degraded one may be holding the last scoreboard read rather than
 * the current one, so the kickoff it would count to is a caption rather than a
 * fact — the same line `WeekFeeds.pricingClocks` draws for the solve. And a
 * page that is not following the week (a snapshot, a dropped stream) has
 * nothing polling for the snap a countdown would promise.
 */
export function gametimeReadout(input: {
  connection: GametimeConnection;
  leagues: LeagueListState;
  /** The scoreboard's own phase counts, or null before an answer lands. */
  games: Games | null;
  /** The earliest kickoff still to come on the board, epoch ms, or null. */
  nextKickoff: number | null;
  /** The room's note that the feeds stopped moving behind a usable page. */
  stale: string | null;
  /** A feed behind the numbers could not be read. */
  degraded: boolean;
}): GametimeReadout {
  const { connection, leagues, games, nextKickoff, stale, degraded } = input;

  if (connection === "complete") return reading("Season complete", false);
  if (leagues === "none") return reading("No leagues", false);
  if (leagues === "loading") return reading("Loading leagues…", false);
  if (connection === "failed") return reading(stale ?? "Live updates unavailable", false);
  if (connection === "snapshot") return reading("Snapshot · not live", false);
  if (connection === "reconnecting") return reading("Reconnecting…", false);
  if (connection === "connecting") return reading("Connecting…", false);
  if (connection === "idle") return reading("Not following", false);

  // Open and answering.
  if (stale) return reading(stale, true);
  if (games === null) return reading("Live", true);
  if (degraded) return reading(`Degraded · ${gamesPhrase(games)}`, true);
  if (games.live > 0) {
    return reading(`Live · ${games.live} game${games.live === 1 ? "" : "s"} in progress`, true, true);
  }
  if (games.pre > 0) {
    return {
      ...reading(`Waiting · ${games.pre} game${games.pre === 1 ? "" : "s"} to come`, true),
      countdownTo: nextKickoff,
    };
  }
  if (games.final > 0) return reading("Final", true);
  return reading("No games on the board", true);
}

/** The time left to a kickoff, broken into what the countdown's bays print. */
export type CountdownParts = { days: number; hours: number; minutes: number; seconds: number };

/**
 * The time left to a kickoff in whole units, or null at and past zero — where
 * there is nothing left to count and the countdown says the game is kicking
 * off instead.
 *
 * Whole seconds **rounded up**, so the last one reads `00:01` rather than
 * `00:00` a second early: a countdown showing zero while the game has not
 * started is claiming a snap that has not happened. And null past zero rather
 * than a negative, because a kickoff the scoreboard has not yet flipped to
 * live is the ordinary state for the minute either side of a snap — the room
 * is polling at the live cadence by then — and a weather delay can hold it
 * longer. "Kicking off" is the honest reading of a game that is due and not
 * yet running; counting up past it, or skipping to the next window, is not.
 */
export function countdownParts(ms: number): CountdownParts | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.ceil(ms / 1000);
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
}

/** One bay of the countdown: its label and its two-digit figure. */
export type CountdownBay = { key: "days" | "hours" | "minutes" | "seconds"; label: string; value: string };

const two = (n: number) => String(n).padStart(2, "0");

/**
 * The bays the countdown draws — **days only where there is a day to count**.
 *
 * A Saturday-night wait is hours, minutes and seconds, and a fourth bay
 * reading `00` beside them is a quarter of the instrument spent saying
 * nothing; a Tuesday-to-Thursday wait needs it, and gets it. Hours, minutes
 * and seconds are always drawn, so the instrument does not change shape inside
 * the last day as the hours run out. Every figure is two digits — a mono
 * instrument keeps its width while it counts — except a wait of a hundred days
 * or more, which prints whole rather than wrapping.
 */
export function countdownBays(parts: CountdownParts): CountdownBay[] {
  const bays: CountdownBay[] = [
    { key: "hours", label: "Hrs", value: two(parts.hours) },
    { key: "minutes", label: "Min", value: two(parts.minutes) },
    { key: "seconds", label: "Sec", value: two(parts.seconds) },
  ];
  return parts.days > 0 ? [{ key: "days", label: "Days", value: two(parts.days) }, ...bays] : bays;
}
