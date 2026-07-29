/**
 * A millisecond duration as a Postgres interval literal, for binding against
 * `$n::interval` in freshness gates (`updated_at < now() - $n::interval`).
 * Rounded to whole seconds — TTLs here are minutes to days, so sub-second
 * precision would be noise.
 */
export const msInterval = (ms: number): string =>
  `${Math.round(ms / 1000)} seconds`;
