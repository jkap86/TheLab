import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveVisit } from "./derive-visit.ts";

test("names the tool for a route with no subject", () => {
  assert.deepEqual(deriveVisit("/trades"), {
    tool: "trades",
    subject: null,
  });
  assert.deepEqual(deriveVisit("/comps"), {
    tool: "comps",
    subject: null,
  });
});

test("reads a username off /manager and folds its case", () => {
  assert.deepEqual(deriveVisit("/manager/JKap86"), {
    tool: "manager",
    subject: "jkap86",
  });
});

test("reads a username off /lineupchecker too", () => {
  assert.deepEqual(deriveVisit("/lineupchecker/JKap86"), {
    tool: "lineupchecker",
    subject: "jkap86",
  });
  // The bare route no longer exists, but a row stored before the username
  // landed still reads — a tool with nothing after it names no subject.
  assert.deepEqual(deriveVisit("/lineupchecker"), {
    tool: "lineupchecker",
    subject: null,
  });
});

test("reads a league id off /picktracker and leaves it alone", () => {
  assert.deepEqual(deriveVisit("/picktracker/1180160000000000000"), {
    tool: "picktracker",
    subject: "1180160000000000000",
  });
});

test("a deeper path is still the same subject", () => {
  assert.deepEqual(deriveVisit("/manager/jkap86/anything"), {
    tool: "manager",
    subject: "jkap86",
  });
});

test("a subject-carrying route with no subject is not a subject", () => {
  // `/picktracker` is a real page — the league picker — and must not be folded
  // in with `/picktracker/<id>` as though someone had opened a draft.
  assert.deepEqual(deriveVisit("/picktracker"), {
    tool: "picktracker",
    subject: null,
  });
});

test("an empty segment is not a segment", () => {
  // Unreachable through the matcher, but the row is data and the function is
  // total: nothing here may index past what the path has.
  assert.deepEqual(deriveVisit("/manager//jkap86"), {
    tool: "manager",
    subject: "jkap86",
  });
});

test("survives the routes the ported original throws on", () => {
  // Its `route_array[1].toLowerCase()` throws on every one of these, taking the
  // whole page's render with it.
  for (const route of ["", "/", "//", "no-leading-slash"]) {
    assert.doesNotThrow(() => deriveVisit(route));
  }
  assert.deepEqual(deriveVisit("/"), { tool: "", subject: null });
  assert.equal(deriveVisit("no-leading-slash").tool, "no-leading-slash");
});

test("trailing slashes do not invent an empty segment", () => {
  assert.deepEqual(deriveVisit("/manager/jkap86/"), {
    tool: "manager",
    subject: "jkap86",
  });
});
