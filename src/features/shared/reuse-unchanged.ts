/**
 * Structural sharing for a list that arrives whole and mostly unchanged.
 *
 * The leagues stream sends its list twice on a refresh — the cached copy, then
 * the synced one — and a hook that stored each as it came handed every memo'd
 * card and every `leagues`-keyed memo a new object per league per `result`,
 * so all of them recomputed twice for a refresh that had changed nothing. The
 * fix is to keep the *previous* object wherever the new one says the same
 * thing: an item is reused when its serialised form is unchanged, and the
 * previous **array** itself is returned when every item was reused in the same
 * order, so a `leagues` identity check upstream holds too.
 *
 * `JSON.stringify` per item is the comparison, and it is the same order of cost
 * as the parse that just produced `next` — cheaper, in fact, since the previous
 * side's serialisation is remembered on the object (`SERIALISED`) from the
 * pass that admitted it, so a steady-state refresh serialises each item once.
 * Not `structuredClone`-style deep equality: a serialiser is one spelling of
 * "the same fact on the wire", where a hand-rolled walk is a second.
 *
 * Kept out of the `features/shared` barrel on `local-store.ts`'s rule: only
 * `use-manager-leagues` builds on it.
 */
export function reuseUnchanged<T extends object>(
  previous: T[],
  next: T[],
  /** What identifies an item across the two lists — a league's `league_id`. */
  key: (item: T) => string,
): T[] {
  if (previous.length === 0) return next.length === 0 ? previous : next;

  const before = new Map<string, T>();
  for (const item of previous) before.set(key(item), item);

  let unchanged = previous.length === next.length;
  const merged = next.map((item, i) => {
    const prior = before.get(key(item));
    if (prior !== undefined && serialised(prior) === serialised(item)) {
      if (prior !== previous[i]) unchanged = false;
      return prior;
    }
    unchanged = false;
    return item;
  });

  return unchanged ? previous : merged;
}

/**
 * An item's wire form, remembered on the item.
 *
 * A `WeakMap` rather than a property, so nothing this reads is written to and
 * a serialisation dies with the object it describes. An item that survives a
 * refresh is serialised once when it first arrives and read back on every
 * later comparison; only the new side pays per pass.
 */
const SERIALISED = new WeakMap<object, string>();

function serialised(item: object): string {
  let s = SERIALISED.get(item);
  if (s === undefined) {
    s = JSON.stringify(item);
    SERIALISED.set(item, s);
  }
  return s;
}
