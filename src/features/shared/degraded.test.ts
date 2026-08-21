import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type {
  LeagueValuesPayload,
  ManagerAdpValuePayload,
  ManagerKtcPayload,
  ManagerMatchupsPayload,
  ManagerRanksPayload,
} from "@/shared/contract";

import {
  adpValueDegraded,
  degradedNotice,
  degradedStaleTime,
  ktcDegraded,
  managerFailures,
  matchupsDegraded,
  ranksDegraded,
  valuesDegraded,
  valuesFailures,
} from "./degraded.ts";

/**
 * The client half of the failure-semantics rule: **an answer carrying a section
 * that could not be computed is drawn and not kept.**
 *
 * Every predicate here separates two payloads that are byte-identical apart from
 * a status word — an empty answer and a failed one — which is exactly why they
 * are worth testing: getting one wrong is silent in both directions. Too eager
 * and a perfectly good read is re-fetched on every mount forever; too slack and
 * a busy second is remembered as a fact for the resource's whole stale time.
 */

const FRESH = 5 * 60 * 1000;

const ranks = (
  projections: ManagerRanksPayload["projections"],
): ManagerRanksPayload => ({ season: "2026", weeks: [], projections, ranks: {} });

const ktc = (lineups: ManagerKtcPayload["lineups"]): ManagerKtcPayload => ({
  season: "2026",
  updated_at: null,
  weeks: [],
  lineups,
  leagues: {},
});

const adp = (
  lineups: ManagerAdpValuePayload["lineups"],
): ManagerAdpValuePayload => ({
  season: "2026",
  weeks: [],
  lineups,
  leagues: {},
});

const values = (
  ktc_status: LeagueValuesPayload["ktc_status"],
  adp_status: LeagueValuesPayload["adp_status"],
): LeagueValuesPayload => ({
  superflex: true,
  ktc_updated_at: null,
  ktc_status,
  adp_status,
  adp_board: "dynasty",
  adp_draft_count: 0,
  ktc: {},
  adp: {},
  adp_position: {},
});

const matchups = (
  projections: ManagerMatchupsPayload["projections"],
): ManagerMatchupsPayload => ({
  season: "2026",
  week: 5,
  projections,
  matchups: {},
});

describe("which payloads count as degraded", () => {
  test("an empty answer is not one, on any of the five reads", () => {
    // All five of these are the legitimate "nothing here": a finished season, a
    // league with no slots, a roster of kickers, a week nobody has a game in.
    // They keep their full stale time.
    assert.equal(ranksDegraded(ranks("ok")), false);
    assert.equal(ktcDegraded(ktc("ok")), false);
    assert.equal(adpValueDegraded(adp("ok")), false);
    assert.equal(valuesDegraded(values("ok", "ok")), false);
    assert.equal(matchupsDegraded(matchups("ok")), false);
  });

  test("a failed section is one, on any of the five", () => {
    assert.equal(ranksDegraded(ranks("error")), true);
    assert.equal(ktcDegraded(ktc("error")), true);
    assert.equal(adpValueDegraded(adp("error")), true);
    assert.equal(matchupsDegraded(matchups("error")), true);
  });

  test("skipped projections are not degraded", () => {
    // `?projections=0` is the answer a reader asked for. Treating it as degraded
    // would make the commonest ranks read in the app permanently stale.
    assert.equal(ranksDegraded(ranks("skipped")), false);
  });

  test("either League Details lens failing degrades the entry they share", () => {
    // One request, one cache key: whichever lens fell over, the entry holding it
    // is the one that must not be reused.
    assert.equal(valuesDegraded(values("error", "ok")), true);
    assert.equal(valuesDegraded(values("ok", "error")), true);
    assert.equal(valuesDegraded(values("error", "error")), true);
  });
});

describe("the stale time a degraded answer is worth", () => {
  test("is the read's own window while nothing has failed", () => {
    const staleTime = degradedStaleTime(FRESH, ranksDegraded);
    assert.equal(staleTime({ state: { data: ranks("ok") } }), FRESH);
    assert.equal(staleTime({ state: { data: ranks("skipped") } }), FRESH);
  });

  test("collapses to zero once a section has failed", () => {
    const staleTime = degradedStaleTime(FRESH, ranksDegraded);
    assert.equal(staleTime({ state: { data: ranks("error") } }), 0);
  });

  test("is the read's own window with nothing cached at all", () => {
    // An entry with no data is not degraded — it is empty, and a zero here would
    // be a claim about an answer nobody has received.
    const staleTime = degradedStaleTime(FRESH, ranksDegraded);
    assert.equal(staleTime({ state: {} }), FRESH);
    assert.equal(staleTime({ state: { data: undefined } }), FRESH);
  });
});

describe("what a reader is told", () => {
  test("nothing at all when everything answered", () => {
    assert.equal(
      degradedNotice(
        managerFailures({ ranks: ranks("ok"), ktc: ktc("ok"), adp: adp("ok") }),
      ),
      null,
    );
    assert.equal(degradedNotice(valuesFailures(values("ok", "ok"))), null);
  });

  test("nothing while the reads are still in flight", () => {
    // A null payload is a read that has not landed, not one that failed — the
    // notice must not fire on a panel that is simply loading.
    assert.deepEqual(managerFailures({ ranks: null, ktc: null, adp: null }), []);
    assert.deepEqual(valuesFailures(null), []);
  });

  test("names the failed sections rather than counting them", () => {
    // A reader looking at em dashes needs to know *which* numbers are missing.
    assert.deepEqual(
      managerFailures({
        ranks: ranks("error"),
        ktc: ktc("ok"),
        adp: adp("error"),
      }),
      ["projected points", "ADP starter splits"],
    );
    assert.deepEqual(valuesFailures(values("error", "ok")), ["KTC values"]);
  });

  test("says the blanks are a shortfall and that nothing needs pressing", () => {
    const line = degradedNotice(["KTC values", "ADP values"]);
    assert.ok(line);
    assert.match(line, /KTC values and ADP values/);
    assert.match(line, /blank rather than zero/);
    assert.match(line, /re-read/);
  });

  test("joins one, two and three names the way the app writes lists", () => {
    assert.match(degradedNotice(["a"])!, /Couldn't load a —/);
    assert.match(degradedNotice(["a", "b"])!, /Couldn't load a and b —/);
    assert.match(degradedNotice(["a", "b", "c"])!, /Couldn't load a, b and c —/);
  });
});
