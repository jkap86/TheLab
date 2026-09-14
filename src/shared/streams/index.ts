// The live streams' shared half: who may open one (`admission`) and how one
// is served (`sse`). Pure — nothing here reaches Sleeper or Postgres — so both
// stream routes, both room modules and Node's own runner import it.
export {
  createStreamAdmission,
  DEFAULT_STREAM_ADMISSION,
  STREAM_ADMISSION_VARS,
  streamAdmission,
  streamAdmissionConfig,
  streamRefusalResponse,
} from "./admission";
export type {
  StreamAdmission,
  StreamAdmissionConfig,
  StreamAdmissionStats,
  StreamKind,
  StreamRefusal,
  StreamRefusalReason,
  StreamReservation,
} from "./admission";
export {
  HEARTBEAT_MS,
  jitteredRetryMs,
  MAX_UNREAD,
  SSE_HEADERS,
  sseStream,
  withStreamReservation,
} from "./sse";
export type { SseFrame, SseJoinResult, SseOptions, SseTimers } from "./sse";
