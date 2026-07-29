import type {
  PicktrackerPayload,
  PicktrackerPickPayload,
} from "@/shared/manager";

/**
 * The shapes this feature renders — aliases of the wire contract in
 * `@/shared/manager` rather than parallel declarations, so the client can't
 * drift from what the route actually sends.
 */
export type { PicktrackerPayload, PicktrackerPickPayload };
