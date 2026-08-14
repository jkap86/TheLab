import type {
  CompsFieldSpecPayload,
  CompsPayload,
  CompsPlayerOptionPayload,
  CompsPlayersPayload,
  CompsResultRowPayload,
  CompsSeasonRowPayload,
} from "@/shared/contract";

/**
 * The shapes this feature renders — aliases of the wire contract in
 * `@/shared/contract` rather than parallel declarations, so the client can't
 * drift from what the routes actually send.
 */
export type {
  CompsFieldSpecPayload,
  CompsPayload,
  CompsPlayerOptionPayload,
  CompsPlayersPayload,
  CompsResultRowPayload,
  CompsSeasonRowPayload,
};
