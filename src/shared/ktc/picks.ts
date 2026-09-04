/**
 * KeepTradeCut's rookie-pick board: how it names a pick, and how a stored pick
 * is resolved to one of its rows.
 *
 * **KTC prices picks, and nothing here was reading them.** The dynasty board
 * carries ~500 skill players *and* 36 `RDP` rows — "2027 Mid 1st", "2028 3rd" —
 * which the sync has stored since `ktc_values` landed. They are invisible to
 * every other read in this folder, and not because anything excludes them:
 * `sleeper_id` is how a KTC row is reached, a pick is not a player anywhere in
 * Sleeper's map, so every pick row carries a null id and nothing could find
 * them. This is the read that can.
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
 * **Deliberately not ported**: TheLabX's `ktcPickBaseSeason`,
 * `ktcPickBoardRows` and `ktcPickDiscount`. Those exist to carry KTC's
 * season-over-season opinion onto its *ADP* scale as a dimensionless ratio —
 * the one thing ADP genuinely cannot answer, since a rookie ladder prices *a*
 * 1.05 and has nothing to say about waiting three years to use one. There is
 * no ADP pick ladder in this repo to scale, so a ratio here would have nothing
 * to multiply; they arrive with `/api/adp`. What that costs today is that a
 * pick in a season KTC has dropped off its board — every 2029 pick, and every
 * round past the fourth — is **unpriced rather than extrapolated**, which is
 * the honest reading and the one {@link ktcPickPrice} already returns null for.
 *
 * Pure and free of runtime imports entirely — the price it hands back is a
 * `{sf, oneqb}` pair and choosing between them is `ktcBoardValue`'s job in
 * `./roster` — so both ends read it: the route deep-imports it to price a
 * portfolio (the module owning `ktc_values` is what queries it), and the
 * client deep-imports it the way it already reaches `@/shared/ktc/roster` for
 * `isSuperflexLineup`.
 */

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
