import assert from "node:assert/strict";
import { test } from "node:test";

import { isToolActive, toolHref, tools, toolsInGroup } from "./tools.ts";

const leagues = tools.find((t) => t.text === "Leagues")!;
const trades = tools.find((t) => t.text === "Trades")!;
const picktracker = tools.find((t) => t.text === "Pick Tracker")!;

test("toolHref falls back to the account-less href", () => {
  assert.equal(toolHref(leagues, null), "/manager");
  // A tool with no `hrefFor` ignores the account entirely.
  assert.equal(toolHref(trades, "jkap86"), "/trades");
});

test("toolHref encodes the username exactly once", () => {
  assert.equal(toolHref(leagues, "jkap86"), "/manager/jkap86/leagues");
  assert.equal(toolHref(leagues, "a b"), "/manager/a%20b/leagues");
  // The trap this helper exists to hold in one place: encoding an already
  // encoded name yields `a%2520b`, which 404s.
  assert.equal(toolHref(leagues, "café"), "/manager/caf%C3%A9/leagues");
});

test("isToolActive matches a wildcard segment", () => {
  assert.equal(isToolActive(leagues, "/manager/jkap86/leagues"), true);
  assert.equal(isToolActive(leagues, "/manager/caf%C3%A9/leagues"), true);
  assert.equal(isToolActive(leagues, "/manager/jkap86/players"), false);
  // The username search owns no tool — it is where you land without an account.
  assert.equal(isToolActive(leagues, "/manager"), false);
});

test("isToolActive matches a prefix, so a sub-route stays inside its tool", () => {
  assert.equal(isToolActive(picktracker, "/picktracker"), true);
  assert.equal(isToolActive(picktracker, "/picktracker/123456"), true);
  assert.equal(isToolActive(trades, "/picktracker"), false);
});

test("every tool lands in a group, and the groups partition the catalogue", () => {
  const grouped = [
    ...toolsInGroup("Manager"),
    ...toolsInGroup("League tools"),
  ];
  assert.equal(grouped.length, tools.length);
});
