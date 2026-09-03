/**
 * Today's date on US Eastern days, as `YYYY-MM-DD`.
 *
 * Two things in this app roll over on Eastern rather than on UTC or on the
 * server's local zone, and both are wrong by a whole day if asked otherwise:
 * KTC's value series (a late-evening scrape filed under tomorrow later collides
 * with the authoritative backfill), and an NFL week's game dates (a Sunday
 * 1pm game is "yesterday" in UTC from 7pm ET, which would settle a lineup seat
 * hours before Sleeper does).
 *
 * `en-CA` for the format rather than a hand-rolled `padStart`: its short date
 * *is* ISO-8601, which is what makes the strings this returns comparable with
 * `<` — the property `dayLockedPlayers` and the KTC snapshot both lean on.
 *
 * `at` is an argument so a caller can date a fixed instant, and so the two
 * readers that want one day for a whole request read the clock once rather than
 * once per row.
 */
export function easternDate(at: number | Date = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
