import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { applyCompsEnrichment, assemblePoolRows } from "./assemble.ts";
import { withCareerValues } from "./career.ts";
import {
  anyCompsEnrichment,
  compsEnrichmentKey,
  listCompsEnrichments,
  NO_COMPS_ENRICHMENTS,
  requiredCompsEnrichments,
} from "./enrichment.ts";
import {
  COMPS_ENRICHMENTS,
  COMPS_FIELDS,
  COMPS_POSITIONS,
  compsField,
  defaultWeightsFor,
} from "./fields.ts";

import type { CompsEnrichmentInputs } from "./assemble.ts";
import type { CompsPoolRow } from "./knn.ts";

/**
 * **What a board is allowed to make the database do.**
 *
 * A cold comps request used to read six things per stored season — the season's
 * stat lines, the profiles behind them, a KTC snapshot, a KTC history
 * aggregate, an ADP average and the NFL draft crosswalk — for a first board
 * that weighs the last four at zero. These tests are the two halves of the fix,
 * and neither is worth much without the other:
 *
 * - **the gate**: which datasets a given board says it needs;
 * - **the agreement**: that a field's declared dataset is really the one its
 *   value comes out of, so the gate's answer is a fact about the numbers rather
 *   than a claim in a catalogue nobody checks.
 *
 * The second is why this is not just a test of `requiredCompsEnrichments`. A
 * field that declared the wrong dataset — or none — would still typecheck, and
 * the symptom would be a column of nulls on a board that asked for it, which
 * looks exactly like a player nobody prices.
 */

const seasonRows = (season: string) =>
  assemblePoolRows({
    statLines: [
      { player_id: "1", week: 1, team: "PHI", stats: { rec: 4, pts_ppr: 12 } },
    ],
    profiles: {
      1: {
        name: "Some Player",
        position: "WR",
        team: "PHI",
        birth_date: "1998-01-01",
      },
    },
    season,
  });

/**
 * A base pool row, as the read hands one to the route: assembled from a
 * season's stat lines and its profiles, then run through the corpus-derived
 * career pass. Two seasons, because the career fields are a fact about the
 * *corpus* — a one-season corpus answers null for them on the rookie rule, and
 * a fixture that couldn't tell that from "not loaded" would be the wrong
 * fixture for these tests in particular.
 */
const CORPUS = withCareerValues([
  { season: "2025", rows: seasonRows("2025") },
  { season: "2024", rows: seasonRows("2024") },
]);

const row = (values: Record<string, number | null> = {}): CompsPoolRow => {
  const base = CORPUS[0].rows[0];
  return { ...base, values: { ...base.values, ...values } };
};

/** One player priced/placed by every dataset, so any of them can be loaded. */
const INPUTS: Required<CompsEnrichmentInputs> = {
  ktc: { 1: { sf: 7000, oneqb: 5000 } },
  ktcHistory: { 1: { peak: 9000, trend: -400 } },
  adp: new Map([
    [
      "1",
      { dynasty: { adp: 12.5 }, redraft: { adp: 30.25 } },
    ],
  ]),
  draft: new Map([
    ["1", { season: "2019", round: 1, slot: 5, overall: 5 }],
  ]),
};

/** The datasets a board would load, as a plain sorted list. */
const needs = (fields: { key: string; weight: number }[]): string[] =>
  listCompsEnrichments(requiredCompsEnrichments(fields));

/** The default board for a position, in the shape the gate reads. */
const defaultBoard = (position: (typeof COMPS_POSITIONS)[number]) =>
  defaultWeightsFor(position);

describe("the default board", () => {
  for (const position of COMPS_POSITIONS) {
    test(`${position} reads stats and profiles and nothing else`, () => {
      // The claim the whole change rests on: the request a reader makes by
      // picking a player and pressing nothing loads no KTC, no KTC history, no
      // ADP and no draft crosswalk — for any of the four positions.
      assert.deepEqual(needs(defaultBoard(position)), []);
      assert.equal(
        anyCompsEnrichment(requiredCompsEnrichments(defaultBoard(position))),
        false,
      );
    });

    test(`${position}'s defaults all answer off a base row`, () => {
      // The other half: not loading those datasets is only safe if the default
      // board's own fields are answerable without them. A default field that
      // came back null would be dropped from the comparison (`resolveCompsFields`),
      // so this failing looks like a board quietly comparing on less.
      const base = row();
      for (const { key } of defaultBoard(position)) {
        assert.notEqual(
          base.values[key],
          null,
          `${position} defaults on ${key}, which no base row answers`,
        );
      }
    });
  }
});

describe("requiredCompsEnrichments", () => {
  test("a KTC weight loads KTC and nothing beside it", () => {
    assert.deepEqual(needs([{ key: "ktc_sf", weight: 60 }]), ["ktc"]);
    assert.deepEqual(needs([{ key: "ktc_oneqb", weight: 20 }]), ["ktc"]);
  });

  test("KTC history is its own dataset — a peak weight does not load the board", () => {
    // Two different queries: the values read is a snapshot as of the anchor,
    // the history read is a peak-and-trend aggregate over the whole series.
    assert.deepEqual(needs([{ key: "ktc_peak_sf", weight: 40 }]), [
      "ktc_history",
    ]);
    assert.deepEqual(needs([{ key: "ktc_trend_sf", weight: 40 }]), [
      "ktc_history",
    ]);
  });

  test("either ADP field loads the one ADP read", () => {
    // Dynasty and redraft come off a single answer, which is why they are one
    // dataset rather than two: splitting them would name two enrichments over
    // one query and load it twice under two keys.
    assert.deepEqual(needs([{ key: "adp_dynasty", weight: 100 }]), ["adp"]);
    assert.deepEqual(needs([{ key: "adp_redraft", weight: 100 }]), ["adp"]);
    assert.deepEqual(
      needs([
        { key: "adp_dynasty", weight: 100 },
        { key: "adp_redraft", weight: 50 },
      ]),
      ["adp"],
    );
  });

  test("draft capital loads the draft crosswalk alone", () => {
    assert.deepEqual(needs([{ key: "draft_capital", weight: 80 }]), ["draft"]);
  });

  test("a production board beside one market field loads only that one", () => {
    assert.deepEqual(
      needs([
        { key: "rec_tgt", weight: 100 },
        { key: "rec_yd", weight: 100 },
        { key: "age", weight: 60 },
        { key: "ktc_sf", weight: 40 },
      ]),
      ["ktc"],
    );
  });

  test("several market fields load several datasets, in catalogue order", () => {
    assert.deepEqual(
      needs([
        { key: "draft_capital", weight: 10 },
        { key: "adp_dynasty", weight: 10 },
        { key: "ktc_sf", weight: 10 },
      ]),
      ["ktc", "adp", "draft"],
    );
  });

  test("a weight of zero names nothing", () => {
    // The parser drops zero-weight fields before this is asked, and the field
    // editor writes a 0 for "off the board" — either way a field switched off
    // must not drag a query in behind it.
    assert.deepEqual(needs([{ key: "ktc_sf", weight: 0 }]), []);
    assert.deepEqual(needs([{ key: "adp_dynasty", weight: -5 }]), []);
  });

  test("an unknown key names nothing rather than everything", () => {
    // Keys reaching here are catalogue-validated, so this is a programming
    // error — and refusing to guess beats loading four datasets on a typo.
    assert.deepEqual(needs([{ key: "not_a_field", weight: 100 }]), []);
  });

  test("a windowed dimension key answers as its field does", () => {
    // A window changes which seasons a value pools, never which table it came
    // out of — and a caller holding resolved specs must get the same answer.
    assert.deepEqual(needs([{ key: "rec_tgt@prev3", weight: 100 }]), []);
  });

  test("nothing needed is the frozen shared answer", () => {
    assert.deepEqual(
      requiredCompsEnrichments([]),
      { ...NO_COMPS_ENRICHMENTS },
    );
    assert.ok(Object.isFrozen(NO_COMPS_ENRICHMENTS));
  });
});

describe("compsEnrichmentKey", () => {
  test("names the datasets loaded, so a composed pool cannot serve another's", () => {
    assert.equal(compsEnrichmentKey(NO_COMPS_ENRICHMENTS), "base");
    assert.equal(
      compsEnrichmentKey(requiredCompsEnrichments([{ key: "ktc_sf", weight: 1 }])),
      "ktc",
    );
  });

  test("two boards naming the same datasets key alike whatever order they came in", () => {
    const a = requiredCompsEnrichments([
      { key: "adp_dynasty", weight: 1 },
      { key: "ktc_sf", weight: 1 },
    ]);
    const b = requiredCompsEnrichments([
      { key: "ktc_oneqb", weight: 99 },
      { key: "adp_redraft", weight: 99 },
    ]);
    assert.equal(compsEnrichmentKey(a), compsEnrichmentKey(b));
  });
});

describe("what a declared dataset actually feeds", () => {
  test("a field naming no dataset answers with none of them loaded", () => {
    const base = row();
    for (const field of COMPS_FIELDS) {
      if (field.reads.length > 0) continue;
      // Production and profile fields are answered by the stat lines and the
      // players cache — the two reads a base pool already makes. `age` is the
      // one to watch: it comes off the profile, not off a market read.
      assert.notEqual(
        base.values[field.key],
        undefined,
        `${field.key} is not on a base row at all`,
      );
    }
    assert.equal(base.values.rec, 4);
    assert.ok(typeof base.values.age === "number");
  });

  test("a field naming a dataset is unknown until that dataset is loaded", () => {
    const base = row();
    for (const field of COMPS_FIELDS) {
      if (field.reads.length === 0) continue;
      assert.equal(
        base.values[field.key],
        null,
        `${field.key} answered without ${field.reads.join("/")} loaded`,
      );
    }
  });

  for (const enrichment of COMPS_ENRICHMENTS) {
    test(`loading ${enrichment} fills exactly the fields that name it`, () => {
      // The agreement in both directions, which is what makes the gate safe:
      // every field declaring this dataset gets a value from it, and no field
      // declaring a *different* one does. Getting this wrong is silent — the
      // board answers, with nulls where the reader asked a question.
      const [enriched] = applyCompsEnrichment([row()], {
        [enrichment === "ktc_history" ? "ktcHistory" : enrichment]:
          INPUTS[enrichment === "ktc_history" ? "ktcHistory" : enrichment],
      });
      for (const field of COMPS_FIELDS) {
        if (field.reads.includes(enrichment)) {
          assert.notEqual(
            enriched.values[field.key],
            null,
            `${field.key} declares ${enrichment} but is not fed by it`,
          );
        } else if (field.reads.length > 0) {
          assert.equal(
            enriched.values[field.key],
            null,
            `${field.key} answered off ${enrichment}, which it does not declare`,
          );
        }
      }
    });
  }

  test("every dataset in the catalogue is one something loads", () => {
    // A `reads` naming a dataset no loader knows would be a field that can
    // never answer; a dataset nothing declares would be a query nothing needs.
    for (const field of COMPS_FIELDS) {
      for (const enrichment of field.reads) {
        assert.ok(
          COMPS_ENRICHMENTS.includes(enrichment),
          `${field.key} reads ${enrichment}, which is not a dataset`,
        );
      }
    }
    for (const enrichment of COMPS_ENRICHMENTS) {
      assert.ok(
        COMPS_FIELDS.some((field) => field.reads.includes(enrichment)),
        `${enrichment} is loaded for nobody`,
      );
    }
  });

  test("only the market and draft-capital fields cost a dataset", () => {
    // Stated as the list rather than as a rule about families, because it is
    // the list a reviewer can check against the loaders in `pool.ts`.
    assert.deepEqual(
      COMPS_FIELDS.filter((field) => field.reads.length > 0).map((f) => f.key),
      [
        "draft_capital",
        "ktc_sf",
        "ktc_oneqb",
        "ktc_peak_sf",
        "ktc_trend_sf",
        "adp_dynasty",
        "adp_redraft",
      ],
    );
  });

  test("a value already loaded is not un-answered by a second, narrower pass", () => {
    // The composition is applied dataset by dataset, so a pass that named only
    // KTC must leave the ADP values alone rather than writing its own absence
    // over them.
    const both = applyCompsEnrichment(
      applyCompsEnrichment([row()], { adp: INPUTS.adp }),
      { ktc: INPUTS.ktc },
    )[0];
    assert.equal(both.values.adp_dynasty, 12.5);
    assert.equal(both.values.ktc_sf, 7000);
  });

  test("nothing to write hands back the same rows — the corpus has not changed", () => {
    // `withCareerValues` memoizes against the identity of what it is handed, so
    // a merge that copied every player-season on file to write nothing would
    // cost the whole archive's enrichment pass on every default request.
    const rows = [row()];
    assert.equal(applyCompsEnrichment(rows, {}), rows);
  });

  test("the draft dataset carries the printed pick as well as the capital", () => {
    const enriched = applyCompsEnrichment([row()], { draft: INPUTS.draft })[0];
    assert.deepEqual(enriched.draft, {
      season: "2019",
      round: 1,
      slot: 5,
      overall: 5,
    });
    assert.ok(typeof enriched.values.draft_capital === "number");
    // And a base row says nothing about where anybody went — which the route
    // fills in for the rows it prints, rather than loading the corpus for it.
    assert.equal(row().draft, null);
  });

  test("a player the dataset has never heard of is unknown, never zero", () => {
    const enriched = applyCompsEnrichment([row()], {
      ktc: {},
      adp: new Map(),
      draft: new Map(),
    })[0];
    assert.equal(enriched.values.ktc_sf, null);
    assert.equal(enriched.values.adp_dynasty, null);
    // Undrafted is a *value* and a missing record is not one: a player with no
    // row at all gets null, where an undrafted player gets the shared notch.
    assert.equal(enriched.values.draft_capital, null);
    assert.equal(enriched.draft, null);
  });
});

describe("the catalogue's own declaration", () => {
  test("every field declares what it reads", () => {
    // Required rather than optional, so a new field cannot forget — the failure
    // being guarded is a market field added with no `reads`, which would answer
    // null on every board that weighted it.
    for (const field of COMPS_FIELDS) {
      assert.ok(Array.isArray(field.reads), `${field.key} declares no reads`);
    }
  });

  test("a field's datasets are declared, not inferred from its family", () => {
    // The market family spans three different queries and the one profile field
    // that costs a query is not in it at all, which is the whole argument for
    // declaring rather than deriving.
    assert.deepEqual(compsField("draft_capital")?.family, "profile");
    assert.deepEqual(compsField("draft_capital")?.reads, ["draft"]);
    assert.deepEqual(compsField("age")?.family, "profile");
    assert.deepEqual(compsField("age")?.reads, []);
  });
});
