/**
 * KeepTradeCut's rookie-pick board: how it names a pick, and how a traded pick
 * is resolved to one of its rows.
 *
 * **KTC prices picks, and this app was throwing that away.** Its board carries
 * ~500 dynasty skill players *and* a few dozen `RDP` rows — "2027 Mid 1st",
 * "2028 3rd" — which the sync has always stored beside the players. Nothing read
 * them, so a trade card priced the players in a haul and said of the picks that
 * they "aren't on KTC's board", which was true of the *player* board and false
 * of the one KTC actually publishes. On a page where a first-round pick is
 * routinely the whole point of the trade, that left the value column quoting
 * half of it.
 *
 * Two questions stand between a stored pick and one of those rows, and they are
 * the reason this is its own module rather than three lines in a query:
 *
 * - **KTC names a pick by a third of the round, Sleeper by a roster.** A stored
 *   pick is `(season, round, roster)` — whose it is, not where it lands — so it
 *   is placed by the league's own draft order: slot 3 of 12 is an early 1st,
 *   slot 11 a late one. The order is only ever known for a draft that exists,
 *   which is a minority of the picks on this board, so the untiered fallback
 *   below is the common case and not the exception.
 * - **The two vocabularies only nearly line up.** KTC lists three tiers for the
 *   drafts it has an opinion about and a single untiered row for the ones it
 *   doesn't, and which seasons fall in which changes through the year. So a
 *   lookup states a preference rather than a key, and says which row it landed
 *   on — {@link ktcPickPrice}.
 *
 * Pure and free of runtime imports beyond {@link ktcBoardValue} — which arrives
 * relatively with a `.ts` extension, the mechanism the pure modules already use
 * between themselves — so both ends read it: the route deep-imports it to send
 * the board (the module owning `ktc_values` is what queries it), and the client
 * deep-imports it to look a pick up, the way it already reaches
 * `@/shared/ktc/roster` for {@link isSuperflexLineup}.
 */

import { ktcBoardValue } from "./roster.ts";

/**
 * Which third of a draft's order a pick falls in — KTC's own carve-up of a
 * round, and the only grain it prices one at.
 */
export type KtcPickTier = "early" | "mid" | "late";

/** In board order, early first; what {@link ktcPickKey} can be asked for. */
export const KTC_PICK_TIERS: readonly KtcPickTier[] = ["early", "mid", "late"];

/**
 * One board row's price on KTC's two boards.
 *
 * Structurally `KtcValue` and read structurally rather than imported, the same
 * way {@link ktcBoardValue} takes its argument: `queries.ts` is `pg`-backed, and
 * a type import from it would be erased but would still put this module's
 * definition on the wrong side of the line the client reads it across.
 */
export type KtcPickPrice = { sf: number | null; oneqb: number | null };

/**
 * The key a pick row is stored and looked up under: its season, its round, and
 * its tier — `"2027|1|mid"`, or `"2027|1|"` for a row KTC gives no tier.
 *
 * The empty trailing segment is deliberate: an untiered row is a real answer
 * ("a 2029 1st", with no opinion about where in the round), not a missing one,
 * so it gets a key of its own rather than being spelled the same as a tiered one.
 * `|` cannot appear in a season, a round or a tier, so the key is unambiguous.
 */
export function ktcPickKey(
  season: string,
  round: number,
  tier: KtcPickTier | null,
): string {
  return `${season}|${round}|${tier ?? ""}`;
}

/** What one of KTC's pick rows says it is. */
export type KtcPickName = {
  season: string;
  round: number;
  /** Null where the row carries no tier at all — see {@link ktcPickKey}. */
  tier: KtcPickTier | null;
};

const TIERS: Record<string, KtcPickTier> = {
  early: "early",
  mid: "mid",
  middle: "mid",
  late: "late",
};

/** Words a pick row can carry that say nothing about which pick it is. */
const NOISE = new Set([
  "round",
  "rounds",
  "rd",
  "rds",
  "rnd",
  "pick",
  "picks",
  "rookie",
  "draft",
]);

/**
 * Parse KTC's own name for a pick row — `"2027 Mid 1st"` → `{2027, 1, mid}`,
 * `"2029 1st"` → `{2029, 1, null}` — or null for anything that isn't one.
 *
 * **Token-based rather than one regex, because the shape of these names is not
 * something KTC has promised.** They are scraped strings on a page that can
 * change whenever KTC likes — the reason `parse.ts` is pure and directly
 * testable — and the ways this could move are all orderings and filler words
 * ("2027 1st Round Pick", "Early 2027 1st") rather than new information. Reading
 * the three facts out of the tokens survives all of those; a regex pinned to one
 * spelling would silently stop matching and take every pick's price with it.
 *
 * An unrecognised word fails the whole name rather than being ignored, so a row
 * this doesn't understand is left unpriced instead of being filed under a pick
 * it might not be.
 */
export function parseKtcPickName(name: string): KtcPickName | null {
  const words = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w !== "" && !NOISE.has(w));

  let season: string | null = null;
  let round: number | null = null;
  let tier: KtcPickTier | null = null;

  for (const word of words) {
    if (/^(19|20)\d{2}$/.test(word)) {
      if (season !== null) return null;
      season = word;
      continue;
    }
    const named = TIERS[word];
    if (named) {
      if (tier !== null) return null;
      tier = named;
      continue;
    }
    const ordinal = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(word);
    if (ordinal) {
      if (round !== null) return null;
      round = Number(ordinal[1]);
      continue;
    }
    return null;
  }

  if (season === null || round === null || round < 1) return null;
  return { season, round, tier };
}

/**
 * Which third of the order a slot falls in — slot 3 of 12 is early, slot 11 late.
 *
 * The boundaries are the terciles of the round, which is how every league uses
 * the words and how KTC's own three rows divide it: in a 12-team draft 1–4 are
 * early, 5–8 mid, 9–12 late.
 *
 * **A slot is placed by the middle of its own cell, not by its leading edge**,
 * which is what keeps the split symmetric when the field doesn't divide by
 * three. Measured from the edge, a 10-team draft comes out 4 early, 3 mid, 3
 * late — the odd pick lands on whichever end the arithmetic happens to favour,
 * and "early" then covers more of the round than "late" does. From the middle it
 * is 3, 4, 3: the ends stay equal and the spare pick falls where the word means
 * least.
 *
 * Null rather than a guess where the arithmetic can't mean anything — a slot
 * outside the field, or a draft of fewer teams than there are tiers, where
 * "early" and "late" would name the same pick. A null here reads exactly as an
 * unknown draft order does downstream, which is the honest reading of both.
 */
export function pickTier(slot: number, teams: number): KtcPickTier | null {
  if (!Number.isFinite(slot) || !Number.isFinite(teams)) return null;
  if (teams < KTC_PICK_TIERS.length || slot < 1 || slot > teams) return null;

  const through = (slot - 0.5) / teams;
  if (through < 1 / 3) return "early";
  if (through < 2 / 3) return "mid";
  return "late";
}

/** A price, and which of KTC's rows it was read off — see {@link ktcPickPrice}. */
export type KtcPickMatch = {
  price: KtcPickPrice;
  /** The tier of the row the price came from; null for an untiered row. */
  tier: KtcPickTier | null;
  /**
   * Whether that row is the pick's own tier. False means the row stands in for
   * one KTC doesn't publish, which is a number worth showing and worth marking
   * — the same distinction between "priced" and "priced exactly" that the
   * league card draws with `priced` of `rostered`.
   */
  exact: boolean;
};

/**
 * The board row to price a pick off, or null where the board has nothing for its
 * season and round at all.
 *
 * `tier` is where the pick falls, or null where the league's draft order isn't
 * set — which is most picks on this board, since most are seasons out and the
 * draft doesn't exist yet. Each case prefers the row that answers its own
 * question and falls back to the other:
 *
 * - **A placed pick** takes its own tier, and an untiered row where KTC prices
 *   that season as a whole. Reading a late 1st off the untiered row understates
 *   it, but by far less than having no number at all.
 * - **An unplaced pick** takes the untiered row first — that row *is* the price
 *   of a pick with no place — and the mid tier where there isn't one, which is
 *   the convention every trade calculator uses for an unknown future pick. It
 *   comes back `exact: false`, so the card can say the number is a stand-in
 *   rather than passing an assumption off as KTC's own answer.
 *
 * A season KTC no longer carries (a pick from a draft that has since happened)
 * matches nothing and returns null, which is a genuine gap and reads as one.
 */
export function ktcPickPrice(
  board: Readonly<Record<string, KtcPickPrice>>,
  pick: { season: string; round: number },
  tier: KtcPickTier | null,
): KtcPickMatch | null {
  const preference: (KtcPickTier | null)[] =
    tier === null ? [null, "mid"] : [tier, null];

  for (const row of preference) {
    const price = board[ktcPickKey(pick.season, pick.round, row)];
    if (price) return { price, tier: row, exact: row === tier };
  }
  return null;
}

/**
 * The earliest season this board prices a pick for — the nearest rookie draft
 * KTC still has an opinion about.
 *
 * It is the reference a future pick is discounted against, and it has to be read
 * off the board rather than off a calendar, because *which* seasons KTC carries
 * moves through the year: a season's rows come off the board once its draft has
 * happened, so through most of a season the nearest priced draft is next year's.
 * Reading it from the board is what makes the discount below mean the same thing
 * in February and in August without anything being told what month it is.
 *
 * Null for a board with no parseable pick rows at all, which is a real state
 * (KTC unsynced, or a rename the parser hasn't learned) and the one case where
 * no pick can be discounted at all.
 */
export function ktcPickBaseSeason(
  board: Readonly<Record<string, KtcPickPrice>>,
): string | null {
  let earliest: string | null = null;
  for (const key of Object.keys(board)) {
    const season = key.slice(0, key.indexOf("|"));
    if (!season) continue;
    if (earliest === null || season < earliest) earliest = season;
  }
  return earliest;
}

/** How much less a future pick is worth than the nearest one — see below. */
export type KtcPickDiscount = {
  /** The pick's KTC price as a fraction of the same pick in {@link base}. */
  factor: number;
  /** The season the fraction is measured against — {@link ktcPickBaseSeason}. */
  base: string;
  /** False where either side of the ratio came off a stand-in row. */
  exact: boolean;
};

/**
 * What a pick in a future season is worth as a fraction of the same pick in the
 * nearest season KTC prices.
 *
 * **This is the only thing KTC is asked for once the value column is ADP's**, and
 * it is asked because ADP genuinely cannot answer it. A rookie-pick ladder is
 * built from the players a draft would return, so it prices *a* 1.05 — it has
 * nothing to say about waiting three years to use one, since the class that pick
 * will spend is not a class anybody can name yet. KTC publishes exactly that
 * opinion, one row per season, and a ratio between two of its rows carries it
 * across to the ADP scale without either board's units coming with it. That is
 * what makes this a legitimate mixing of the two where summing them is not: a
 * ratio is dimensionless.
 *
 * A pick at or before the base season is undiscounted (`factor: 1`), which is
 * also how a current-year pick is priced — the ladder *is* the current class, so
 * there is nothing to discount it by. Everything later reads KTC's own rows for
 * both ends, through {@link ktcPickPrice}, so the tier preference and its
 * fallbacks are the same ones the KTC column uses rather than a second spelling.
 *
 * Null where the ratio cannot be formed — no board, no row for the pick's
 * season, no row for the base at that round, or a base priced at zero. Null is
 * what leaves a far-future pick **unpriced** rather than quoting it at a nearby
 * pick's value, which is the one wrong answer here that would look like a
 * working one: a 2032 4th is not worth what next year's 4th is.
 */
export function ktcPickDiscount(
  board: Readonly<Record<string, KtcPickPrice>>,
  pick: { season: string; round: number },
  tier: KtcPickTier | null,
  /** Which of KTC's two boards both ends of the ratio are read on. */
  superflex: boolean,
): KtcPickDiscount | null {
  const base = ktcPickBaseSeason(board);
  if (base === null) return null;
  // Seasons are four-digit years, so a string compare is the numeric one.
  if (pick.season <= base) return { factor: 1, base, exact: true };

  const future = ktcPickPrice(board, pick, tier);
  const nearest = ktcPickPrice(board, { season: base, round: pick.round }, tier);
  if (!future || !nearest) return null;

  const value = ktcBoardValue(superflex, future.price);
  const anchor = ktcBoardValue(superflex, nearest.price);
  if (value === null || anchor === null || anchor <= 0) return null;

  return { factor: value / anchor, base, exact: future.exact && nearest.exact };
}
