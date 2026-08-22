import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FIRST_SLEEPER_SEASON } from "../../manager-season.ts";
import { ManagerHeader } from "./manager-header.tsx";

/**
 * The plate without a DOM — the league card's own test, for the part that moved
 * to the same family of materials.
 *
 * **The slab is four class strings that have to agree with each other, and every
 * way of getting it wrong is invisible in review.** A wall wrapper whose chamfer
 * the face doesn't repeat shows a square corner behind a bevelled one; a face
 * that keeps `.lab-slab-face`'s corner-lit fill degenerates at this part's
 * proportions and leaves its trailing third sitting on the page ground; a slab
 * without `.lab-slab-fixed` lifts and blooms under the cursor, promising a press
 * that lands on nothing. None of the three is a type error, none changes the
 * content, and each reads as "the header looks a bit off" rather than as a bug
 * with a name. So they are pinned as strings, which is the only thing that can
 * hold an agreement no compiler can see.
 *
 * Rendered with the countdown off, because {@link HeaderReadout}'s clock half
 * mounts `useKickoff` — a query hook, which in a markup test is a fetch-shaped
 * thing dragged in behind a class assertion. The dial is the other half of the
 * same slot and the surface under it is identical either way.
 */

function plate(over: Partial<Parameters<typeof ManagerHeader>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ManagerHeader, {
      user: {
        user_id: "1",
        username: "jkap",
        display_name: "jkap",
        // Both halves: the stored id and the resolved URL. Null here so
        // {@link Avatar} draws its initial rather than an <img> this test has no
        // network for — the fallback is what carries the ring the surface
        // assertion below had to learn to look past.
        avatar: null,
        avatar_url: null,
      },
      season: "2026",
      record: { wins: 72, losses: 48, ties: 1, games: 121, pct: 0.54, leagues: 113 },
      scope: "dynasty leagues",
      leagueCount: 121,
      stat: { label: "Leagues", value: "121", sub: "of 121 total" },
      // The dial rather than the clock — see the note above.
      countdown: false,
      ...over,
    }),
  );
}

describe("the plate's material", () => {
  test("is a slab, and the wall and the face carry the same chamfer", () => {
    const html = plate();

    // A wall that turns four corners has to be cut on all four, on *both*
    // layers: the wrapper is the wall and the child is the lit face, so a notch
    // on one of them alone leaves the other showing a square corner behind it.
    assert.match(html, /class="lab-slab lab-slab-fixed lab-notch-all"/);
    assert.match(html, /class="lab-slab-face lab-slab-face-rail lab-notch-all[^"]*"/);
  });

  test("the face is the rail's fill, not a card's", () => {
    const html = plate();

    // `.lab-slab-face-rail` has to come *with* `.lab-slab-face` — it overrides
    // only the fill and the two falloffs, and inherits the brushed grain and the
    // specular sweep — and it has to come after it, since they collide on
    // `background` and `box-shadow` and source order decides.
    const face = html.match(/class="(lab-slab-face[^"]*)"/);
    assert.ok(face, "the plate should render a slab face");
    assert.ok(
      face[1].indexOf("lab-slab-face") < face[1].indexOf("lab-slab-face-rail"),
      "the rail fill must be declared after the face it overrides",
    );
  });

  test("it does not lift under the cursor", () => {
    // The header holds readouts; it is not a card you press. `.lab-slab-fixed`
    // is what cancels `.lab-slab`'s hover lift and bloom, and it only wins
    // because it is declared after `.lab-slab:hover` in `globals.css` — so its
    // presence here is half of an agreement whose other half is in that file.
    assert.match(plate(), /lab-slab-fixed/);
  });

  test("no glass survives on the surface itself", () => {
    const html = plate();

    // The marks of the surface this replaced, asserted as absences because the
    // failure they describe is a *partial* revert — a border or a
    // translucent-white fill left on a milled face reads as a seam in the part
    // rather than as an obvious mistake.
    //
    // **Scoped to the plate's own two boxes, not to the document.** The first
    // spelling of this asserted `border-foreground/10` was absent from the whole
    // render and failed on {@link Avatar}'s fallback ring — a different
    // component, several levels in, whose border is nothing to do with this
    // card's material. A surface assertion that reaches past its own surface
    // fails on whatever a child legitimately does.
    const surfaces = [...html.matchAll(/class="(lab-slab[^"]*)"/g)].map((m) => m[1]);
    assert.equal(surfaces.length, 2, "the plate is a wall and a face");
    for (const cls of surfaces) {
      assert.doesNotMatch(cls, /rounded/);
      assert.doesNotMatch(cls, /border/);
      assert.doesNotMatch(cls, /bg-\[/);
      assert.doesNotMatch(cls, /shadow-\[/);
    }
  });
});

describe("what the corners and the body owe the wall", () => {
  test("the corner tabs carry no outer radius", () => {
    const html = plate();

    // The plate's own `clip-path` cuts these tabs on its 9px diagonal, because a
    // clip applies to the whole subtree. A radius under that cut is a curve
    // inside a bevel — the tab reads as *almost* fitting its corner, which is
    // worse than either alone.
    assert.doesNotMatch(html, /rounded-tl-\[15px\]/);
    assert.doesNotMatch(html, /rounded-tr-\[15px\]/);
    // The inner returns stay: those corners are in the face, not on its edge.
    assert.match(html, /rounded-br-lg/);
    assert.match(html, /rounded-bl-lg/);
  });

  test("the body clears the face's own sweep", () => {
    // `.lab-slab-face::after` is generated last, so with everything on `auto` it
    // paints over the content. This plate's sweep has always sat *under* it.
    assert.match(plate(), /class="relative z-\[1\] flex items-center/);
  });

  test("the record bar is bands, or it is nothing", () => {
    // Preseason every league reports `0-0`, so the rail would be drawn empty —
    // a progress bar at zero under digits whose own rule is that `pct` is null
    // rather than `.000` there. The dial beside it already answers with an em
    // dash. See {@link RecordBar}, whose constant-height premise went when this
    // card stopped pinning itself under the app bar.
    const unplayed = plate({
      record: { wins: 0, losses: 0, ties: 0, games: 0, pct: null, leagues: 121 },
    });
    assert.doesNotMatch(unplayed, /max-w-\[26\.25rem\]/);
    // And it is still drawn the moment there is a proportion to draw.
    assert.match(plate(), /max-w-\[26\.25rem\]/);
  });

  test("the caveat lane is reserved whether or not there is a caveat", () => {
    // The lane is what keeps {@link SyncCaveats} off the record bar, and
    // reserving it *permanently* is the point: a lane that appeared with the
    // caveat would be the layout shift moving that row out of flow was for.
    // Asserted on the quiet header, which is the case that would regress.
    // This lane and the bar above part company on purpose — a caveat comes and
    // goes inside one session, where a season starts once a year.
    assert.match(plate(), /pb-5 sm:pb-6/);
  });

  test("the top inset clears the taller of the two spellings of the season tab", () => {
    // 24px, and one number at every width rather than the 22 it used to be
    // below `sm`: the stepper spelling of the season tab is 22px of key against
    // 20px of bare digits, and the plate must not be two heights for one card —
    // so the *quiet* header is what this is asserted on, since that is the case
    // a "tighten it back up" edit would regress.
    assert.match(plate(), /pt-6 sm:gap-4/);
    assert.doesNotMatch(plate(), /pt-\[22px\]/);
  });

  test("the trailing inset pays for the wall", () => {
    const html = plate();

    // The leading and trailing edges are where the bordered box put them
    // (`pl-5`+border and `px-4`+border). The trailing 6px is wall now, so the
    // padding gives it back — otherwise the part is 20px in on one side and
    // 26px in on the other, which reads as not square.
    //
    // Both terms of each sum stay in the `calc`, per `--app-font-scale`: the rem
    // half scales with the type and the border and wall are material. A literal
    // here squares the plate at one scale and at no other.
    assert.ok(html.includes("pl-[calc(1.25rem+1px)] pr-[calc(1rem+1px-6px)]"));
    assert.ok(html.includes("sm:pl-[calc(1.5rem+1px)] sm:pr-[calc(1.25rem+1px-6px)]"));
  });
});

/**
 * Where the two sync states are drawn, which is the whole of what moving them
 * out of the plate's flow was for.
 */

/** The `progress` message the header reads a running tally off. */
const progress = {
  type: "progress",
  phase: "refresh",
  loaded: 41,
  total: 121,
  failed: 0,
} as Parameters<typeof ManagerHeader>[0]["progress"];

/** A summary that dropped three leagues to a Sleeper failure. */
const partial = {
  leagues: 97,
  total: 100,
  failed: 3,
  locked: false,
  complete: false,
} as Parameters<typeof ManagerHeader>[0]["summary"];

/**
 * The extent of the element carrying `cls`, as `[start, end)` into the markup.
 *
 * A stack walk rather than a regex, because the one rule worth pinning here is a
 * *nesting* rule and a regex cannot see nesting. `clip-path` clips a whole
 * subtree, so a plate that straddles the slab's edge has to be its sibling — and
 * a refactor that tidies it back inside the face produces markup that looks
 * right, renders with no error, and silently severs the plate at the exact edge
 * it exists to cross.
 */
function extentOf(html: string, cls: string): [number, number] {
  const start = html.indexOf(`<div class="${cls}`);
  assert.notEqual(start, -1, `no element carrying ${cls}`);
  let depth = 0;
  const tag = /<(\/?)div\b[^>]*?(\/?)>/g;
  tag.lastIndex = start;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    if (m[2] === "/") continue; // self-closing, never a <div> but cheap to skip
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0) return [start, m.index + m[0].length];
  }
  throw new Error(`unbalanced markup around ${cls}`);
}

describe("a refresh in flight", () => {
  test("puts the flask in the readout slot", () => {
    const html = plate({ refreshing: true, progress });

    assert.match(html, /class="flask-loader/);
    // Announced once, by name. The flask brings its own `role="status"`.
    assert.match(html, /aria-label="Refreshing leagues"/);
  });

  test("keeps the readout under it, dimmed rather than dropped", () => {
    const html = plate({ refreshing: true, progress });

    // The dial still sizes the slot — that is what makes the swap free of
    // layout — so it stays in the markup, dimmed and hidden from the reading.
    assert.match(html, /class="opacity-\[0\.12\]" aria-hidden="true"/);
    assert.match(html, /Win pct/);
  });

  test("the running tally is written but not announced", () => {
    const html = plate({ refreshing: true, progress });

    // It ticks once per league; a polite region re-reading "41/121" every few
    // hundred milliseconds talks over the page it is describing. The rule came
    // with the state when it moved out of the old line.
    assert.match(html, /aria-hidden="true"[^>]*>41\/121</);
  });

  test("draws no caveat plate on its own", () => {
    // The split `hasSyncCaveat` exists for: a refresh is a process, not a
    // standing fact about the rows on screen.
    assert.doesNotMatch(plate({ refreshing: true, progress }), /lab-nameplate-warn/);
  });

  test("a quiet header draws neither", () => {
    const html = plate();
    assert.doesNotMatch(html, /flask-loader/);
    assert.doesNotMatch(html, /lab-nameplate-warn/);
  });
});

describe("a standing caveat", () => {
  test("states how much of the list is current", () => {
    assert.match(plate({ summary: partial }), />97 of 100 leagues refreshed</);
  });

  test("rides an edge plate, out of the plate's flow", () => {
    const html = plate({ summary: partial });

    assert.match(html, /class="lab-nameplate-warn/);
    // Out of flow: it hangs off the bottom edge rather than adding a row.
    assert.match(html, /absolute -bottom-3/);
  });

  test("is a sibling of the slab, never inside it", () => {
    const html = plate({ summary: partial });
    const [, slabEnds] = extentOf(html, "lab-slab lab-slab-fixed lab-notch-all");
    const caveat = html.indexOf("lab-nameplate-warn");

    assert.ok(
      caveat > slabEnds,
      "the caveat plate is inside the slab, so `clip-path` will sever it",
    );
  });

  test("both kinds can be up at once", () => {
    // A refresh started after a pass that dropped leagues: the process is live
    // and the caveat about the rows already on screen still stands. They are at
    // opposite corners, which is why neither has to make room for the other.
    const html = plate({ refreshing: true, progress, summary: partial });
    assert.match(html, /flask-loader/);
    assert.match(html, /lab-nameplate-warn/);
  });
});

/**
 * The season corner, in both of its spellings.
 *
 * **Every assertion here is a rule with no compiler behind it and no wrong
 * number on screen.** A step key that keeps its wall when it has nowhere to go
 * is a part promising a press that does nothing; one drawn any further left is a
 * lit face `clip-path` slices on the plate's 9px chamfer, which reads as a
 * control with no thickness — the one thing a pressable part must never be; and
 * a card that grew a stepper it was never given would be the lineup checker
 * offering a choice of season for a week's lineups.
 */
describe("the season corner", () => {
  /** The manager tabs' spelling: a readout with a step either side. */
  const stepped = (over: { season?: string; latest?: string } = {}) =>
    plate({
      season: over.season ?? "2026",
      seasonControl: { latest: over.latest ?? "2026", onChange: () => {} },
    });

  test("is a plain readout where the page offers no choice", () => {
    // The lineup checker reads the season it is *in*, so there is nothing to
    // choose. Absent the control this is byte-for-byte the tab it always was.
    const html = plate();
    assert.doesNotMatch(html, /Previous season/);
    assert.doesNotMatch(html, /Next season/);
    // And no live region: announcing a value nothing can change is a promise to
    // report something that never happens.
    assert.doesNotMatch(html, /aria-live="polite"[^>]*>2026/);
  });

  test("draws both steps, labelled by what they do", () => {
    const html = stepped();
    assert.match(html, /aria-label="Previous season"/);
    assert.match(html, /aria-label="Next season"/);
    // The keys say what they do, so the thing a press changes has to announce
    // itself — otherwise the control is legible only to someone who can see it.
    assert.match(html, /aria-live="polite"/);
  });

  test("a step with nowhere to go loses its wall, and stays reachable", () => {
    const html = stepped({ season: "2026", latest: "2026" });
    const forward = keyMarkup(html, "Next season");
    const back = keyMarkup(html, "Previous season");

    // Flat and unlit rather than merely dim: the app bar's rule at this size.
    assert.doesNotMatch(forward, /lab-chip/);
    assert.match(forward, /cursor-not-allowed/);
    // `aria-disabled`, never `disabled` — the latter takes the key out of the
    // tab order, and a reader who cannot reach it cannot discover why it's dead.
    assert.match(forward, /aria-disabled="true"/);
    assert.doesNotMatch(forward, /\sdisabled(=|\s|>)/);

    // The live one is a raised key, and the thin wall rather than the full one:
    // it sits inside a 22px well.
    assert.match(back, /lab-chip lab-chip-sm/);
    assert.doesNotMatch(back, /aria-disabled/);
  });

  test("the floor is Sleeper's first season, not a step below it", () => {
    const html = stepped({ season: FIRST_SLEEPER_SEASON, latest: "2026" });
    assert.match(keyMarkup(html, "Previous season"), /cursor-not-allowed/);
    assert.match(keyMarkup(html, "Next season"), /lab-chip/);
  });

  test("the keys start past the chamfer the plate cuts out of this corner", () => {
    // `.lab-notch-all` takes a 9px diagonal off the top-left, and `clip-path`
    // clips a whole subtree. The tab's own `pl-3.5` starts its contents 14px in,
    // which is what keeps the leading key's lit face whole. Trimming that inset
    // is the edit this catches.
    assert.match(stepped(), /rounded-br-lg pl-3\.5/);
  });

  test("the stepper spends its padding on the keys, not on the tab", () => {
    // 22px of key defines the tab's height, which is within 2px of the plain
    // tab's 20 — near enough that the two corners still read as one scale. It is
    // a box cut around a glyph, so it is spelled in rem and both stay within
    // that 2px of each other at any `--app-font-scale`.
    assert.match(stepped(), /py-0 pr-1/);
    assert.match(stepped(), /h-\[1\.375rem\] w-\[1\.125rem\]/);
  });
});

/** One step key's own tag, so a class assertion can't match its neighbour's. */
function keyMarkup(html: string, label: string): string {
  const at = html.indexOf(`aria-label="${label}"`);
  assert.notEqual(at, -1, `no key labelled ${label}`);
  const start = html.lastIndexOf("<button", at);
  const end = html.indexOf(">", at);
  assert.ok(start !== -1 && end !== -1, `unbalanced markup around ${label}`);
  return html.slice(start, end + 1);
}
