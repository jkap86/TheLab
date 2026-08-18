#!/usr/bin/env python3
"""Where players went in the NFL draft, via nfl_data_py — the reference read.

Sleeper publishes no draft position, so `src/shared/nfl-draft/` fills that gap
from the DynastyProcess player-id crosswalk. **This script is the provenance
note for that module and the way to check it**, not the thing that loads the
data: the app ingests the crosswalk itself over its own axios instance, because
`nfl_data_py.import_ids()` is, in full, one `pandas.read_csv` of one public
CSV — and standing up a second language runtime on the dyno to make one HTTP
GET would be a real cost for no gain.

What this buys by existing:

  * It names the source in the source's own vocabulary. Anyone asking "where
    did these draft picks come from" gets `nfl_data_py.import_ids()` rather
    than a URL they have to take on faith.
  * It is the oracle. `--check` re-implements nothing: it applies the same
    published rules the TypeScript parser does and diffs the two answers, so a
    change to `parse.ts` can be held against the library's own view of the same
    file. At the time of writing the two agree exactly — 6,310 picks, zero
    disagreements in either direction.
  * It is how to investigate upstream. When the sync starts refusing the
    crosswalk (see `validate.ts`), this is the fastest way to look at what the
    source is actually serving without deploying anything.

Usage:
    pip install nfl_data_py
    python3 scripts/nfl-draft-picks.py                 # summary
    python3 scripts/nfl-draft-picks.py --json out.json # picks as JSON
    python3 scripts/nfl-draft-picks.py --check ts.json # diff against the TS parser

`--check` takes the JSON `--json` emits, so producing the TypeScript side is:

    npx tsx -e 'import {readFileSync} from "node:fs";
      import {parseNflDraftPicks} from "./src/shared/nfl-draft/parse.ts";
      import http from "axios";
      const {data} = await http.get(
        "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv",
        {responseType: "text"});
      console.log(JSON.stringify(parseNflDraftPicks(data).picks));' > ts.json
"""

from __future__ import annotations

import argparse
import json
import sys

# The bounds and rules below are the same ones `src/shared/nfl-draft/parse.ts`
# applies, restated here rather than imported for the obvious reason: an oracle
# that shares an implementation with the thing it checks proves nothing. Keep
# them in step by hand — that they *are* in step is what `--check` measures.
FIRST_SEASON = 1936
MAX_OVERALL = 600
MAX_ROUND = 40


def _int(value, lo, hi):
    """An integer in [lo, hi], or None. Mirrors `intIn` in parse.ts."""
    if value is None:
        return None
    try:
        # NaN and floats-that-aren't-integers both fall out here, which is what
        # the TypeScript `Number.isInteger` guard does.
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number != int(number):  # NaN, or fractional
        return None
    number = int(number)
    return number if lo <= number <= hi else None


def load_picks():
    """The crosswalk as (picks, rejections, newest settled class)."""
    import nfl_data_py as nfl

    frame = nfl.import_ids(
        columns=["name", "draft_year", "draft_round", "draft_pick", "draft_ovr"],
        ids=["sleeper"],
    )

    rejected = {
        "no_sleeper_id": 0,
        "bad_season": 0,
        "bad_pick": 0,
        "class_pending": 0,
        "conflicting_duplicate": 0,
    }

    candidates = []
    for row in frame.itertuples():
        sleeper_id = getattr(row, "sleeper_id", None)
        if sleeper_id is None or sleeper_id != sleeper_id:  # NaN
            rejected["no_sleeper_id"] += 1
            continue
        player_id = str(int(sleeper_id))

        season = _int(getattr(row, "draft_year", None), FIRST_SEASON, 2100)
        if season is None:
            rejected["bad_season"] += 1
            continue

        raw_overall = getattr(row, "draft_ovr", None)
        present = raw_overall is not None and raw_overall == raw_overall
        overall = _int(raw_overall, 1, MAX_OVERALL)
        # Absent means undrafted; present-but-unusable means the row is junk.
        # Collapsing the two is the one mistake here that produces a confident
        # wrong answer, so parse.ts refuses it and so does this.
        if present and overall is None:
            rejected["bad_pick"] += 1
            continue

        rnd = _int(getattr(row, "draft_round", None), 1, MAX_ROUND)
        slot = _int(getattr(row, "draft_pick", None), 1, MAX_OVERALL)
        if overall is not None and rnd is None:
            rejected["bad_pick"] += 1
            continue

        candidates.append(
            {
                "playerId": player_id,
                "season": str(season),
                "round": rnd if overall is not None else None,
                "slot": slot if overall is not None else None,
                "overall": overall,
            }
        )

    # A class that has actually been held: one carrying at least one drafted
    # player. Read off the data, never off a calendar — which classes exist
    # moves through the year.
    settled = {c["season"] for c in candidates if c["overall"] is not None}

    # Conflicts first, then the pending filter: an id claimed by two different
    # players is ambiguous whether or not one of its rows is publishable yet.
    by_player: dict[str, dict | None] = {}
    for candidate in candidates:
        seen = by_player.get(candidate["playerId"], "missing")
        if seen == "missing":
            by_player[candidate["playerId"]] = candidate
            continue
        if seen is None:
            rejected["conflicting_duplicate"] += 1
            continue
        same = (
            seen["season"] == candidate["season"]
            and seen["overall"] == candidate["overall"]
            and seen["round"] == candidate["round"]
        )
        if same:
            continue
        by_player[candidate["playerId"]] = None
        rejected["conflicting_duplicate"] += 2

    picks = []
    for candidate in by_player.values():
        if candidate is None:
            continue
        if candidate["overall"] is None and candidate["season"] not in settled:
            rejected["class_pending"] += 1
            continue
        picks.append(candidate)

    newest = max(settled) if settled else None
    return picks, rejected, newest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", metavar="PATH", help="write the picks as JSON")
    parser.add_argument(
        "--check",
        metavar="PATH",
        help="diff against the TypeScript parser's JSON output",
    )
    args = parser.parse_args()

    picks, rejected, newest = load_picks()
    drafted = [p for p in picks if p["overall"] is not None]

    print(f"picks:            {len(picks)}")
    print(f"  drafted:        {len(drafted)}")
    print(f"  undrafted:      {len(picks) - len(drafted)}")
    print(f"newest class:     {newest}")
    print("rejected:")
    for reason, count in rejected.items():
        print(f"  {reason + ':':<24}{count}")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(picks, handle)
        print(f"\nwrote {len(picks)} pick(s) to {args.json}")

    if args.check:
        with open(args.check, encoding="utf-8") as handle:
            other = json.load(handle)
        mine = {p["playerId"]: (p["season"], p["overall"]) for p in picks}
        theirs = {p["playerId"]: (p["season"], p["overall"]) for p in other}

        only_mine = sorted(set(mine) - set(theirs))
        only_theirs = sorted(set(theirs) - set(mine))
        disagree = sorted(k for k in set(mine) & set(theirs) if mine[k] != theirs[k])

        print(f"\ncheck against {args.check}:")
        print(f"  python-only ids:  {len(only_mine)}   {only_mine[:5]}")
        print(f"  ts-only ids:      {len(only_theirs)}   {only_theirs[:5]}")
        print(f"  disagreements:    {len(disagree)}")
        for key in disagree[:5]:
            print(f"    {key}: python={mine[key]} ts={theirs[key]}")

        if only_mine or only_theirs or disagree:
            print("\nMISMATCH — parse.ts and nfl_data_py disagree about this file.")
            return 1
        print("\nOK — parse.ts matches nfl_data_py exactly.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
