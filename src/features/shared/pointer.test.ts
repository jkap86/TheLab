import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FINE_POINTER_QUERY, hasFinePointer } from "./pointer.ts";

/**
 * Whether the thing reading the page is a mouse — which is the whole of what
 * decides if a sheet may take the focus.
 *
 * Focusing a text field on a phone *is* raising the software keyboard, over a
 * list the reader opened to scroll and a sheet sized in `vh`. Asked of the
 * platform rather than of the user agent string, because a UA test would have to
 * enumerate devices and would be wrong about the next one.
 */

const answering = (matches: boolean) => (query: string) => {
  assert.equal(query, FINE_POINTER_QUERY);
  return { matches };
};

describe("what may take the focus", () => {
  test("a mouse may; a finger may not", () => {
    assert.equal(hasFinePointer(answering(true)), true);
    assert.equal(hasFinePointer(answering(false)), false);
  });

  test("the query is the *primary* pointer, not any pointer", () => {
    // `(pointer: fine)` is what a laptop with a touchscreen answers true to and
    // an iPad with a keyboard attached answers false to, which is the reading
    // this wants. `(any-pointer: fine)` would be true of both.
    assert.equal(FINE_POINTER_QUERY, "(pointer: fine)");
  });

  test("unknown answers false, and the asymmetry is the point", () => {
    // A server render, an engine without `matchMedia`, or a query that throws.
    // Autofocus withheld from a desktop reader costs one click on a field they
    // can see; autofocus given to a phone throws a keyboard over the list.
    assert.equal(hasFinePointer(null), false);
    assert.equal(hasFinePointer(undefined), false);
    assert.equal(
      hasFinePointer(() => {
        throw new Error("unparseable media query");
      }),
      false,
    );
  });

  test("a query answering nothing is not a fine pointer", () => {
    assert.equal(hasFinePointer(() => null), false);
    assert.equal(hasFinePointer(() => undefined), false);
    // And nothing but a real `true` counts — an engine handing back a truthy
    // non-boolean must not read as a mouse.
    assert.equal(
      hasFinePointer(() => ({ matches: 1 as unknown as boolean })),
      false,
    );
  });
});
