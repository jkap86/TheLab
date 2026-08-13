import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ManagerLeague } from "@/shared/manager";

// The bezel's own classes, from where they live now: the leagues list draws the
// same run on its cards, so the part moved to `features/shared/ui` and these
// moved with it. What is still this card's is the *line* it sits on.
import { SPEC_CAPTION, SPEC_SEAM } from "@/features/shared/ui/league-specs";

import { TRADE_METRICS } from "../../trade-metrics";
import type { TradeMetric } from "../../trade-metrics";
import type {
  AdpPlayerPayload,
  KtcValue,
  PlayerSummary,
  Trade,
  TradeManager,
} from "../../types";
import { TradeCard } from "./trade-card";
import { SIDE_SEAM_COLUMN, SIDE_SEAM_ROW } from "./trade-card.constants.ts";

/**
 * The card without a DOM.
 *
 * `renderToStaticMarkup` answers what a reader *sees* — React runs on the
 * server, so this needs no browser and no dependency — which is very nearly the
 * whole of what this component is: it holds no state and no effect, and its one
 * handler (the press that opens the league) is a click on a wrapper, so there is
 * nothing here that a static render leaves untested but the click itself.
 *
 * What it is for is the half of the card that no type can hold. The material
 * classes, the breakpoints, the two tones and the rules about when a line is
 * drawn at all are strings and conditionals, so every one of them survives a
 * refactor silently or not at all — a give track that lost its groove, an odd
 * side that stopped spanning the row, or an origin line that started printing on
 * every pick would all typecheck.
 */

// Named rather than indexed: the catalogue's order is a *display* decision (the
// column a card opens with moved from KTC to ADP), and these tests are about
// what each metric draws.
// The caption's class list is long and its leading token is enough to anchor a
// match against the markup without pinning the whole string twice.
const SPEC_CAPTION_PROBE = SPEC_CAPTION.split(" ")[0];

const ktcMetric = TRADE_METRICS.find((m) => m.key === "ktc")!;
const adpMetric = TRADE_METRICS.find((m) => m.key === "adp")!;

/**
 * A metric with nothing to say per line, which the catalogue no longer holds —
 * the haul counts were its only instance and they are gone, since each counted
 * lines the card draws by name a few pixels below. `TradeMetric.asset` stays
 * optional all the same, so the card still has to draw one: the side total, and
 * no per-line column beside it.
 */
const totalOnly: TradeMetric = {
  key: "total-only",
  group: "Test",
  label: "Test",
  cell: () => ({ kind: "value", text: "12", title: "a side total" }),
};

const players: Record<string, PlayerSummary> = {
  p1: { name: "Christian McCaffrey", position: "RB", team: "SF" } as PlayerSummary,
  p2: { name: "Ja'Marr Chase", position: "WR", team: "CIN" } as PlayerSummary,
  // Off KTC's board entirely — the em dash rather than a zero.
  p3: { name: "Justin Tucker", position: "K", team: "BAL" } as PlayerSummary,
};

const managers: Record<string, TradeManager> = {
  u1: { user_id: "u1", display_name: "jkap", avatar_url: null } as TradeManager,
  u2: {
    user_id: "u2",
    display_name: "DarksideEmperors",
    avatar_url: null,
  } as TradeManager,
  u3: { user_id: "u3", display_name: "ThirdParty", avatar_url: null } as TradeManager,
};

const ktc: Record<string, KtcValue> = {
  p1: { sf: 8000, oneqb: 8600 },
  p2: { sf: 9100, oneqb: 9900 },
};

const pickKtc: Record<string, KtcValue> = {
  "2027|1|early": { sf: 6000, oneqb: 5200 },
  "2027|1|": { sf: 4700, oneqb: 4000 },
};

/**
 * The ADP panel's board. The league below starts five and drafts twelve, so the
 * pool is 60 and the default four halvings make value `10000 · 2^(−(adp−1)/15)`
 * — 16 is half the peak and 31 a quarter of it. The kicker is absent from the
 * map entirely, which is how a player past the board's tail arrives.
 */
const adp: Record<string, AdpPlayerPayload> = {
  p1: {
    player_id: "p1",
    name: "Christian McCaffrey",
    position: "RB",
    team: "SF",
    rookie: false,
    redraft: { picks: 30, adp: 31, min_pick: 20, max_pick: 44, stdev: 5.5 },
    dynasty: { picks: 25, adp: 16, min_pick: 8, max_pick: 30, stdev: 4.4 },
    // The card's KTC column reads its own `ktc` map, never the board's row.
    ktc: null,
  },
  p2: {
    player_id: "p2",
    name: "Ja'Marr Chase",
    position: "WR",
    team: "CIN",
    rookie: false,
    redraft: { picks: 30, adp: 16, min_pick: 4, max_pick: 26, stdev: 3.3 },
    dynasty: { picks: 25, adp: 31, min_pick: 12, max_pick: 48, stdev: 6.6 },
    ktc: null,
  },
};

/**
 * The rookie class in the order the rookie drafts took them, each rung carrying
 * its *startup* ADP — the number the value curve reads. The league below starts
 * five and drafts twelve, so rung 3 (where roster 2's 2027 first lands) is a
 * startup ADP of 31 and a quarter of the peak. Twelve rungs, so a second-rounder
 * runs off the end.
 */
const adpLadders = {
  dynasty: [1, 16, 31, 46, 61, 76, 91, 106, 121, 136, 151, 166].map(
    (startupAdp, i) => ({
      player_id: `r${i + 1}`,
      name: `Rookie ${i + 1}`,
      rookieAdp: i + 1,
      rookiePicks: 20,
      startupAdp,
      startupSource: "observed" as const,
      startupPicks: 18,
    }),
  ),
  redraft: [],
};

/** Roster 2's 2027 pick has a place; nothing else does. */
const pickSlots: Record<string, number> = { "L1|2027|2": 3 };

const league: ManagerLeague = {
  league_id: "L1",
  name: "The Lab Dynasty",
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: null,
  settings: { type: 2 },
  roster_positions: ["QB", "SUPER_FLEX", "RB", "WR", "TE", "BN"],
  scoring_settings: { rec: 1 },
} as ManagerLeague;

/**
 * The ordinary card: two sides, one holding two players and two picks — one of
 * them the counterparty's own, one from a third party.
 */
const twoSided: Trade = {
  transaction_id: "t1",
  league_id: "L1",
  week: 3,
  completed_at: new Date(2026, 6, 15, 15, 7).getTime(),
  sides: [
    {
      roster_id: 1,
      user_id: "u1",
      players: ["p1", "p3"],
      picks: [
        // From the roster handing it over — no origin line.
        { season: "2027", round: 1, roster_id: 2, user_id: "u2" },
        // From somebody not in this trade — worth every character.
        { season: "2028", round: 2, roster_id: 9, user_id: "u3" },
      ],
      faab: 55,
    },
    { roster_id: 2, user_id: "u2", players: ["p2"], picks: [], faab: 0 },
  ],
};

const threeSided: Trade = {
  transaction_id: "t2",
  league_id: "L1",
  week: null,
  completed_at: new Date(2026, 0, 2, 3, 5).getTime(),
  sides: [
    { roster_id: 1, user_id: "u1", players: ["p1"], picks: [], faab: 0 },
    { roster_id: 2, user_id: "u2", players: ["p2"], picks: [], faab: 0 },
    // Came away with nothing, which the card says in words.
    { roster_id: 3, user_id: null, players: [], picks: [], faab: 0 },
  ],
};

function card(over: Partial<Parameters<typeof TradeCard>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(TradeCard, {
      trade: twoSided,
      league,
      players,
      managers,
      metric: ktcMetric,
      ktc,
      pickKtc,
      adp,
      adpLadders,
      steepness: 4,
      pickSlots,
      // The card's one handler. Nothing here presses it —
      // `renderToStaticMarkup` has no DOM to press with — so it is a stub, and
      // what these tests are about is the markup.
      onOpenLeague: () => {},
      ...over,
    }),
  );
}

/** How many times a class appears — the tracks and plates are counted, not found. */
function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("the card's material", () => {
  test("the slab and its face both carry the chamfer", () => {
    const html = card();
    // A wall that turns two corners shows a square one wherever the clip
    // doesn't follow it, so the notch is on both layers.
    assert.match(html, /class="lab-slab lab-notch-lg"/);
    assert.match(html, /class="lab-slab-face lab-notch-lg/);
  });

  test("no side is a plate: the card is the only object in the list", () => {
    // The correction the card was rebuilt for. A side wearing this card's own
    // construction one step down read as a card of its own, which is what made
    // a phone show a column of manager plates rather than a list of trades.
    const html = card({ trade: threeSided });
    assert.doesNotMatch(html, /lab-plate/);
    assert.doesNotMatch(html, /lab-slab-face[^"]*lab-slab/);
  });

  test("every side after the first is cut off the one before it", () => {
    // Two sides: the second is in the trailing column, so its seam is vertical
    // from `sm` up. Three: the odd one spans the row and takes a horizontal cut
    // along its top, since it is under both columns rather than beside either.
    //
    // **Every seam on this card is now between two sides**, which is what the
    // counts say and is worth knowing as a fact about the card rather than about
    // the test: a `Rosters before this trade` disclosure used to hang below the
    // sides on a horizontal cut of its own, and these totals each carried a `+ 1`
    // for it. That reading is the league sheet's timeline now.
    assert.equal(count(card(), SIDE_SEAM_COLUMN), 1);
    // The column seam textually contains the row seam, so the row count picks it
    // up too — and, with the disclosure gone, only it.
    assert.equal(count(card(), SIDE_SEAM_ROW), 1);
    const three = card({ trade: threeSided });
    assert.equal(count(three, SIDE_SEAM_COLUMN), 1);
    assert.equal(count(three, SIDE_SEAM_ROW), 2);
  });

  test("both plates ride the edge, outside the clip that would cut them", () => {
    // `clip-path` clips its whole subtree, so a plate inside the notched face
    // would be severed at the exact edge it exists to straddle. The wrapper's
    // `pt-3` is the overhang they straddle into, and what follows it is the row
    // that lays the two out — not the rest of that element's class list, which
    // also carries the press.
    const html = card();
    assert.match(html, /pt-3"><div class="pointer-events-none absolute/);
    assert.doesNotMatch(html, /lab-slab-face[\s\S]*lab-nameplate/);
  });

  test("the edge is one row, so the name truncates against the instant", () => {
    // A plate that positions itself can only cap its own width, and what the
    // name may take is whatever the timestamp doesn't — a width that is its own
    // contents, and a different one for an undated trade. As two items of one
    // flex row the negotiation is the layout's.
    const html = card();
    assert.match(html, /class="pointer-events-none absolute[^"]*flex items-start justify-between/);
    // Both plates are in it, name first, and each takes its presses back from
    // the row that would otherwise eat them.
    assert.equal(count(html, "lab-nameplate"), 2);
    assert.equal(count(html, "pointer-events-auto"), 2);
    assert.ok(html.indexOf("The Lab Dynasty") < html.indexOf("Jul 15, 2026"));
  });

  test("the league's name is a button inside the heading, and the rosters are the only other one", () => {
    // Pressing a card opens that league, and the whole card is the target — but
    // the *button* is the name, because `role="button"` on the card would take
    // presentational children and flatten two manager blocks and a dozen asset
    // lines to one label. A `<button>` takes phrasing content and a heading is
    // flow, so the button is inside the `h2` rather than around it.
    const html = card();
    assert.match(html, /<h2 [^>]*><button type="button"[^>]*>The Lab Dynasty<\/button><\/h2>/);

    // **Exactly one, and the count is the guard.** A card in a windowed list of
    // forty thousand is not somewhere a second control should arrive by
    // accident, and one did once: a `Rosters before this trade` disclosure,
    // which made this number two and made the card a thing that changes height
    // under a virtualizer. What it opened is the league sheet's timeline now, so
    // the card is back to one press with one destination.
    assert.equal(count(html, "<button"), 1);
    assert.doesNotMatch(html, /aria-expanded/);
  });

  test("the nameplate carries the accent rail, and it is decoration", () => {
    assert.match(card(), /<span aria-hidden="true" class="lab-billet-rail/);
  });

  test("everything read rather than pressed is recessed, and none is a lens", () => {
    // A lens is glass with a cyan rim around the whole of it — the *lit*
    // reading the card trades away, so nothing here wears it. A gauge is the
    // near miss worth keeping apart: its accent is the lit lower lip of a cut,
    // which is light falling into a recess rather than an outline around a
    // value, and an outline is what a control has.
    const html = card();
    // The date and each side's total.
    assert.equal(count(html, "lab-readout"), 3);
    // One bezel holding one gauge per league spec.
    assert.equal(count(html, "lab-bezel"), 1);
    assert.equal(count(html, "lab-gauge"), 4);
    assert.doesNotMatch(html, /lab-lens/);
  });

  test("nothing on the card is a chip", () => {
    // The bar's grammar: raised means press me. The league specs are read, so a
    // run of `.lab-chip` pills would be six apparent controls per card that do
    // nothing — across the couple of dozen the virtualiser keeps mounted.
    assert.doesNotMatch(card(), /lab-chip/);
  });
});

describe("what the header says", () => {
  test("the league's name, and the id only until the list answers", () => {
    assert.match(card(), /The Lab Dynasty/);
    assert.match(card({ league: null }), />L1</);
  });

  test("the date is cut into the plate and the time is engraved beside it", () => {
    // The record ledge's grammar one tool over: the primary reading sits in a
    // `.lab-readout` cut and the secondary one is engraved next to it, so the
    // part reads as a housing around an instrument rather than a second label.
    const html = card();
    assert.match(html, /lab-readout[^"]*"[^>]*>Jul 15, 2026</);
    assert.match(html, /lab-engraved[^"]*"[^>]*>3:07 PM</);
    assert.ok(html.indexOf("Jul 15, 2026") < html.indexOf("3:07 PM"));
    // Two elements parted by a gap and a change of material — no punctuation.
    assert.doesNotMatch(html, /Jul 15, 2026 · 3:07 PM/);
  });

  test("what kind of league it was, on the line the instant used to share", () => {
    // The whole point of the run: this board spans every crawled league, so a
    // pick is a different asset card to card and the name alone only helps a
    // reader who already knows the league.
    const html = card();
    assert.match(html, /Dynasty/);
    assert.match(html, /12 Team/);
    assert.match(html, /1QB \+ SF/);
    assert.match(html, /1TE/);
  });

  test("every gauge carries the unit its value counts", () => {
    // The one thing the tokens lacked and the reason the run is gauges: nothing
    // on a phone says what `1QB + SF` is a count of, because there is no hover
    // there to ask.
    const html = card();
    for (const caption of ["Type", "Teams", "QB", "TE"]) {
      assert.match(html, new RegExp(`${SPEC_CAPTION_PROBE}[^>]*>${caption}<`));
    }
  });

  test("the run is one housing, and the first gauge wears no seam", () => {
    // Six separate housings read as perforation in the face rather than as one
    // fact about the league. The seam is applied by index because Tailwind has
    // no adjacent-sibling selector, so the off-by-one is a real risk: a seam on
    // the first bay would be a line down the inside of the bezel's own wall.
    const html = card();
    assert.equal(count(html, "lab-bezel"), 1);
    assert.equal(count(html, SPEC_SEAM), 3, "one fewer than the four gauges");
  });

  test("the header line is the specs alone, with no breakpoint left on it", () => {
    // It held the instant too, which is why it was a reversed row that stacked
    // below `sm` — the run had ~180px beside a right-flushed timestamp and took
    // three lines there. With the instant on the edge it is one block at every
    // width.
    const html = card();
    assert.match(html, /<header class="px-3 pb-2">/);
    assert.doesNotMatch(html, /flex-row-reverse/);
  });

  test("no specs and no bezel at all until the league list answers", () => {
    // A league with no settings in hand has none to report, and a housing of em
    // dashes would report six holes rather than one absence.
    //
    // Counted in material rather than matched on the words: "dynasty" and
    // "1QB" appear in every KTC title on the card, which is a different claim
    // — the board a haul is priced on, not the league it happened in.
    const html = card({ league: null });
    assert.equal(count(html, "lab-readout"), 3, "the date and two totals");
    assert.equal(count(html, "lab-bezel"), 0);
    assert.equal(count(html, "lab-gauge"), 0);
    // Not an empty header either: the line is dropped whole.
    assert.doesNotMatch(html, /<header/);
  });

  test("an unsynced lineup drops the lineup tokens rather than reading them as zero", () => {
    // The rule this shares with the filters: null is not zero. The league is
    // still a 12-team dynasty and still says so.
    const html = card({ league: { ...league, roster_positions: null } });
    assert.match(html, /Dynasty/);
    assert.match(html, /12 Team/);
    assert.doesNotMatch(html, /0TE|0QB/);
  });

  test("an undated trade says so, on a plate it still draws", () => {
    // Where this parts company with the leagues list's record ledge, which
    // renders nothing rather than an empty housing: here the absence *is* the
    // answer, since a trade Sleeper filed with no timestamp is dropped by every
    // date bound on this board.
    const html = card({ trade: { ...twoSided, completed_at: null } });
    assert.match(html, /date unknown/);
    assert.equal(count(html, "lab-nameplate"), 2);
    // Nothing dangles after the words, and no empty element stands in for the
    // time — the two used to share one readout, where the separator rode on the
    // half that vanishes.
    assert.doesNotMatch(html, /date unknown ·/);
    assert.doesNotMatch(html, /date unknown<\/span><span[^>]*><\/span>/);
  });

  test("the scoring week is not on the card — the instant replaced it", () => {
    assert.doesNotMatch(card(), /Wk 3/);
  });
});

describe("the two tracks", () => {
  test("the give track is a groove; the take track is the card's own face", () => {
    // One per side on a two-sided trade: each side's give is the other's take.
    assert.equal(count(card(), "lab-groove"), 2);
  });

  test("a three-way draws no give track at all", () => {
    // Nothing Sleeper stores says which participant an asset came through, so a
    // column of guessed `−` lines is not drawn.
    assert.equal(count(card({ trade: threeSided }), "lab-groove"), 0);
  });

  test("the tracks split from `sm` up and stack below it", () => {
    assert.match(card(), /sm:grid-cols-\[minmax\(0,1\.15fr\)_minmax\(0,0\.85fr\)\]/);
  });

  test("a side whose counterparty took nothing draws no groove", () => {
    const lopsided: Trade = {
      ...twoSided,
      sides: [
        { roster_id: 1, user_id: "u1", players: ["p1", "p2"], picks: [], faab: 0 },
        { roster_id: 2, user_id: "u2", players: [], picks: [], faab: 0 },
      ],
    };
    // Only the side that received nothing has a give half worth drawing.
    assert.equal(count(card({ trade: lopsided }), "lab-groove"), 1);
  });

  test("both signs are drawn, and neither is announced", () => {
    const html = card();
    assert.match(html, /aria-hidden="true" class="mr-1 inline-block w-\[0\.7em\] tabular-nums text-active\/50">\+/);
    assert.match(html, /aria-hidden="true" class="mr-1 inline-block w-\[0\.7em\] tabular-nums text-foreground\/25">−/);
  });
});

describe("what a line names", () => {
  test("a take line carries the player's position and team", () => {
    assert.match(card(), /Christian McCaffrey<span class="ml-1\.5 whitespace-nowrap text-\[11px\] text-foreground\/45">RB · SF/);
  });

  test("a give line names the player and nothing else", () => {
    // Ja'Marr Chase is roster 2's take and roster 1's give; the give spelling
    // carries no position, since the take one a column over always does.
    const html = card();
    assert.equal(count(html, "WR · CIN"), 1);
    assert.equal(count(html, "Chase"), 2);
  });

  test("an unknown player id stands in for itself rather than blanking", () => {
    const html = card({ players: {} });
    assert.match(html, />p1</);
  });

  test("a placed pick is named by its slot, an unplaced one by its round", () => {
    const html = card();
    // Roster 2's 2027 pick has an order; the 2028 one does not.
    assert.match(html, /2027 1\.03/);
    assert.match(html, /2028 2nd/);
  });

  test("a pick's origin is drawn only where it is a surprise", () => {
    const html = card();
    // The third party's pick names them; the counterparty's own does not.
    assert.match(html, /from ThirdParty/);
    assert.doesNotMatch(html, /from DarksideEmperors/);
  });

  test("an uncached owner falls back to the roster number", () => {
    assert.match(card({ managers: {} }), /from roster 9/);
  });

  test("FAAB is spelled with its currency and its unit", () => {
    assert.match(card(), /\$55 FAAB/);
  });
});

describe("what a value column says", () => {
  test("a side's total is labelled where it sits", () => {
    assert.match(card(), /KTC/);
  });

  test("a multi-line track prices each line", () => {
    // Roster 1 took four assets, so the breakdown says something the total
    // doesn't and each covered line carries its own number.
    assert.match(card(), /title="Dynasty KTC, superflex board"/);
  });

  test("a breakdown of one is the total, so a single-line track has none", () => {
    const single: Trade = {
      ...twoSided,
      sides: [
        { roster_id: 1, user_id: "u1", players: ["p1"], picks: [], faab: 0 },
        { roster_id: 2, user_id: "u2", players: ["p2"], picks: [], faab: 0 },
      ],
    };
    assert.equal(count(card({ trade: single }), 'title="Dynasty KTC, superflex board"'), 0);
  });

  test("covered and unpriced is an em dash, never a zero", () => {
    const html = card();
    assert.match(html, /Not priced on the superflex board/);
    assert.match(html, /—/);
    assert.doesNotMatch(html, />0<\/span>/);
  });

  test("a metric with no per-asset form prices no line", () => {
    const html = card({ metric: totalOnly });
    assert.doesNotMatch(html, /title="Dynasty KTC/);
    // The side total is still there — it is the per-line column that isn't.
    assert.match(html, /a side total/);
  });

  test("the board follows the league's own lineup", () => {
    assert.match(card(), /superflex board/);
    assert.match(
      card({ league: { ...league, roster_positions: ["QB", "RB", "WR", "BN"] } }),
      /1QB board/,
    );
    // An unsynced lineup falls to 1QB rather than guessing the richer board.
    assert.match(card({ league: null }), /1QB board/);
  });
});

describe("what the ADP column says", () => {
  const adpCard = (over: Partial<Parameters<typeof TradeCard>[0]> = {}) =>
    card({ metric: adpMetric, ...over });

  test("a side's total is the panel's board, priced on this league's pool", () => {
    // Roster 1 took McCaffrey (dynasty ADP 16, half the peak over a pool of 60),
    // a kicker the board has never heard of, a placed 2027 first (rung 3, a
    // quarter of the peak) and a 2028 second past the class the board priced.
    const html = adpCard();
    assert.match(html, /5,000/);
    assert.match(html, /7,500/);
    // Players and picks in one denominator, since the ladder puts them on one
    // scale; FAAB is on no board and so is in neither half of it.
    assert.match(html, /2 of 4 assets priced/);
  });

  test("the market follows the league's type, not the card's first payload half", () => {
    assert.match(adpCard(), /dynasty ADP/);
    // Keeper and redraft both read the redraft board; so does a league the list
    // hasn't answered for, which is the broader market rather than a guess.
    const redraft = { ...league, settings: { type: 0 } };
    assert.match(adpCard({ league: redraft }), /redraft ADP/);
    assert.match(adpCard({ league: null }), /redraft ADP/);
  });

  test("an ADP line states the sample its average came off", () => {
    assert.match(adpCard(), /title="ADP 16\.0 on the dynasty board · picks 8–30 over 25 drafts"/);
  });

  test("a player the board never took is an em dash, never a zero", () => {
    const html = adpCard();
    assert.match(html, /Not on the dynasty ADP board/);
    assert.doesNotMatch(html, />0<\/span>/);
  });

  test("a pick is priced by the rookie its rung names", () => {
    // Roster 2's 2027 first is placed at slot 3, so it is rung 3 of the ladder —
    // 2,500 — and the hover names the rookie the number is standing on rather
    // than leaving a reader to take it on trust.
    const html = adpCard();
    assert.match(html, /2027 1\.03/);
    assert.match(
      html,
      /Rookie pick 3 ≈ Rookie 3, startup ADP 31\.0 on the dynasty board/,
    );
    assert.match(html, /2,500/);
  });

  test("a pick KTC can't reach is an em dash, and says which wall it hit", () => {
    // The 2028 second is off both ends: rung 18 of a twelve-rung class, and no
    // KTC row to discount it by either. The class is the nearer wall.
    assert.match(adpCard(), /Deeper than the rookie class/);
  });

  test("FAAB is on no board, so it carries no cell on either column", () => {
    // KTC's own pick title is what the pick half is checked against; the FAAB
    // line has no `title` under either metric.
    assert.match(card(), /2027 Early 1st/);
    assert.doesNotMatch(adpCard(), /2027 Early 1st/);
    assert.match(adpCard(), /\$55 FAAB/);
  });
});

describe("what order a track lists a haul in", () => {
  /**
   * The same trade stored back to front: the unpriced kicker above the priced
   * back, and the pick no board can reach above the one that is placed. That is
   * how a haul genuinely arrives — Sleeper's `adds` is a map from player to
   * roster, so its order says nothing about the trade — which is why what a
   * reader sees has to be the ranking rather than the storage.
   */
  const scrambled: Trade = {
    ...twoSided,
    sides: [
      {
        roster_id: 1,
        user_id: "u1",
        players: ["p3", "p1"],
        picks: [
          { season: "2028", round: 2, roster_id: 9, user_id: "u3" },
          { season: "2027", round: 1, roster_id: 2, user_id: "u2" },
        ],
        faab: 55,
      },
      twoSided.sides[1],
    ],
  };

  /** Where a line is drawn, so the assertions read as the order on the card. */
  const order = (html: string, ...needles: string[]) =>
    needles.map((needle) => {
      const at = html.indexOf(needle);
      assert.notEqual(at, -1, needle);
      return at;
    });

  test("players lead, ranked, and the picks follow doing the same", () => {
    const [mccaffrey, tucker, first, second] = order(
      card({ trade: scrambled }),
      "Christian McCaffrey",
      "Justin Tucker",
      "2027 1.03",
      "2028 2nd",
    );
    // Priced above unpriced inside the players block, players above picks, and
    // the placed first above the pick KTC has no row for.
    assert.ok(mccaffrey < tucker);
    assert.ok(tucker < first);
    assert.ok(first < second);
  });

  test("the ranking follows the column, not the storage", () => {
    // The same haul under ADP, where the kicker is off the board and the 2028
    // second is past the class the ladder priced — so both sink in their own
    // block rather than out of it.
    const [mccaffrey, tucker, first, second] = order(
      card({ trade: scrambled, metric: adpMetric }),
      "Christian McCaffrey",
      "Justin Tucker",
      "2027 1.03",
      "2028 2nd",
    );
    assert.ok(mccaffrey < tucker);
    assert.ok(tucker < first);
    assert.ok(first < second);
  });

  test("FAAB stays last, whatever the column says about the rest", () => {
    for (const metric of TRADE_METRICS) {
      const html = card({ trade: scrambled, metric });
      const [faab, ...assets] = order(
        html,
        // The line, not the FAAB column's own hover — which spells the same
        // words a few elements above it, on the side total.
        "$55 FAAB<",
        "Christian McCaffrey",
        "Justin Tucker",
        "2027 1.03",
        "2028 2nd",
      );
      assert.ok(
        assets.every((at) => at < faab),
        metric.key,
      );
    }
  });
});

describe("how the sides are laid out", () => {
  test("two sides share the row from `sm` up, with no gap between them", () => {
    // No gap: the sides are regions of one face, so what parts them is a cut
    // and not the ground showing between two objects.
    assert.match(card(), /class="grid sm:grid-cols-2"/);
  });

  test("the odd side of a three-way spans the row", () => {
    // An empty cell beside it would read as a participant who came away with
    // nothing, which is a state this card draws in words instead.
    assert.equal(count(card({ trade: threeSided }), "sm:col-span-2"), 1);
    assert.equal(count(card(), "sm:col-span-2"), 0);
  });

  test("a side that took nothing says so", () => {
    assert.match(card({ trade: threeSided }), /Nothing<\/p>/);
  });

  test("an unnamed participant is a roster rather than a blank", () => {
    assert.match(card({ trade: threeSided }), /Roster 3/);
  });
});

describe("the card as a document", () => {
  test("the league is the card's heading and each track is a list", () => {
    const html = card();
    assert.match(html, /<article/);
    assert.match(html, /<h2/);
    assert.match(html, /<ul/);
    assert.match(html, /<li/);
  });

  test("nothing carries an id, so forty thousand cards cannot collide", () => {
    assert.deepEqual(card().match(/ id="[^"]*"/g) ?? [], []);
  });

  test("every card renders for every metric in the catalogue", () => {
    for (const metric of TRADE_METRICS) {
      for (const trade of [twoSided, threeSided]) {
        assert.ok(card({ metric, trade }).length > 200, metric.key);
      }
    }
  });
});
