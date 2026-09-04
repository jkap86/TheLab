import assert from "node:assert/strict";
import { test } from "node:test";

import {
  facetOptions,
  matches,
  matchesQuery,
  NO_FILTERS,
  toLogRow,
  totals,
} from "./facets.ts";

const entry = (id: string, route: string, ip: string | null) => ({
  id,
  seen_at: `2026-09-04T0${id}:00:00.000Z`,
  ip,
  route,
});

const ROWS = [
  entry("1", "/manager/jkap86", "203.0.113.5"),
  entry("2", "/trades", "203.0.113.5"),
  entry("3", "/manager/slim", "198.51.100.7"),
  entry("4", "/tools", null),
].map(toLogRow);

test("a row carries what its route says", () => {
  assert.equal(ROWS[0].tool, "manager");
  assert.equal(ROWS[0].subject, "jkap86");
  assert.equal(ROWS[1].subject, null);
});

test("filters are AND, and an empty one is not a filter", () => {
  assert.equal(ROWS.filter((r) => matches(r, NO_FILTERS)).length, 4);
  const both = { ...NO_FILTERS, tool: "manager", subject: "jkap86" };
  assert.deepEqual(
    ROWS.filter((r) => matches(r, both)).map((r) => r.id),
    ["1"],
  );
});

test("a facet's own menu is built without its own selection", () => {
  // The rule this module exists for. With an IP chosen, the IP menu must still
  // offer the others — the ported original narrows it to the one selected, so
  // the choice can only be cleared, never changed.
  const filters = { ...NO_FILTERS, ip: "203.0.113.5" };
  const options = facetOptions(ROWS, filters);
  assert.deepEqual(options.ip, ["198.51.100.7", "203.0.113.5"]);
  // Every *other* menu is narrowed by that IP, which is the half that must
  // still work: only the two rows from that address carry these.
  assert.deepEqual(options.subject, ["jkap86"]);
  assert.deepEqual(options.tool, ["manager", "trades"]);
});

test("each menu is narrowed by every other facet", () => {
  const filters = { ...NO_FILTERS, tool: "manager" };
  const options = facetOptions(ROWS, filters);
  assert.deepEqual(options.subject, ["jkap86", "slim"]);
  assert.deepEqual(options.tool, ["manager", "tools", "trades"]);
});

test("a selected value survives even when nothing else matches it", () => {
  // Otherwise a <select> shows a value its own <option> list does not contain,
  // and the browser silently resets it to the first one.
  const filters = { ...NO_FILTERS, tool: "trades", subject: "nobody" };
  assert.ok(facetOptions(ROWS, filters).subject.includes("nobody"));
});

test("a row with no answer for a facet is not an option", () => {
  // `/tools` and `/trades` have no subject and one visit has no address;
  // neither may appear as a blank entry in a menu.
  const options = facetOptions(ROWS, NO_FILTERS);
  assert.deepEqual(options.subject, ["jkap86", "slim"]);
  assert.equal(options.subject.includes(""), false);
  assert.equal(options.ip.includes(""), false);
});

test("addresses sort numerically, not as text", () => {
  const many = [
    entry("1", "/tools", "10.0.0.10"),
    entry("2", "/tools", "10.0.0.9"),
  ].map(toLogRow);
  assert.deepEqual(facetOptions(many, NO_FILTERS).ip, ["10.0.0.9", "10.0.0.10"]);
});

test("search reads the route and the address", () => {
  assert.equal(matchesQuery(ROWS[0], "jkap"), true);
  assert.equal(matchesQuery(ROWS[0], "203.0"), true);
  assert.equal(matchesQuery(ROWS[0], "manager"), true);
  assert.equal(matchesQuery(ROWS[0], "nope"), false);
  assert.equal(matchesQuery(ROWS[3], "anything"), false);
  // An empty needle is not a narrowing.
  assert.equal(matchesQuery(ROWS[3], ""), true);
});

test("totals count distinct values and skip the absent ones", () => {
  assert.deepEqual(totals(ROWS), {
    visits: 4,
    ips: 2,
    subjects: 2,
  });
});
