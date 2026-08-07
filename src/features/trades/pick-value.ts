/**
 * The rookie-pick ladder, re-exported from where it lives now.
 *
 * It moved to `features/shared/pick-value` when the ADP drawer became its second
 * reader — the mover's rule — and this file is the other half of that rule: the
 * consumers here (the trade metrics, the cards, the list) already import
 * `./pick-value`, so one canonical definition is read under two names rather
 * than a sweep through a dozen call sites.
 *
 * Relative, with the explicit `.ts` extension, because the modules importing it
 * are tested by Node's runner, which strips types but knows no `@/*` aliases.
 */
export {
  TYPICAL_DRAFT_TEAMS,
  middleSlot,
  pickAdpValue,
  pickEstimated,
  rookieLadder,
  rookiePickNumber,
} from "../shared/pick-value.ts";
export type {
  PickAdpMatch,
  PickAdpMiss,
  PickAdpResult,
  RookieLadderRung,
  StartupAdpSource,
} from "../shared/pick-value.ts";
