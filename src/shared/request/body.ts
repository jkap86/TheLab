/**
 * Read a request body **within** a byte bound, rather than reading it whole
 * and measuring it afterwards.
 *
 * `request.text()` allocates the entire body before anything can be said about
 * its size, so a route that "checks the length" after calling it has already
 * paid for whatever arrived — a 1 MiB body was allocated in full before the
 * intended 512-byte limit turned it away. Nothing in the framework bounds an
 * App Router `Request` body on this side: the bound has to be enforced while
 * the bytes arrive, and it has to be *bytes*, since a JavaScript string's
 * length counts characters and a multibyte body is longer on the wire than in
 * memory.
 *
 * Three rules, and each is a case a test drives:
 *
 * - **A declared length past the bound is refused before a byte is read.** A
 *   `Content-Length` is a claim, and a claim that is already too large needs no
 *   evidence.
 * - **The bound is enforced against what actually arrives**, so a chunked body
 *   with no declared length, or one whose declared length understates it, is
 *   stopped at the first chunk that crosses the line — and the reader is
 *   cancelled there, so the rest of the body is never pulled.
 * - **Decoding and parsing happen only on a body inside the bound**, and a body
 *   that is not valid UTF-8, or not valid JSON, is a refusal with its own
 *   reason rather than an exception a caller has to guess the shape of.
 */

export type BodyRefusal =
  /** Declared or actual size past the bound. */
  | "too-large"
  /** The stream errored or ended early. */
  | "interrupted"
  /** Bytes that are not UTF-8. */
  | "encoding";

export type BodyRead =
  | { ok: true; text: string; bytes: number }
  | { ok: false; reason: BodyRefusal };

/**
 * The declared `Content-Length`, or null where there is none to read.
 *
 * An unparseable value is read as absent: the HTTP layer has already refused a
 * header it could not parse, so what reaches here is either a number or
 * nothing, and the actual byte count below is the bound either way.
 */
export function declaredLength(headers: Headers): number | null {
  const raw = headers.get("content-length")?.trim();
  if (!raw || !/^\d{1,15}$/.test(raw)) return null;
  return Number(raw);
}

/** Read up to `maxBytes` of `request`'s body as UTF-8 text. */
export async function readBodyWithin(request: Request, maxBytes: number): Promise<BodyRead> {
  const declared = declaredLength(request.headers);
  if (declared !== null && declared > maxBytes) return { ok: false, reason: "too-large" };

  const body = request.body;
  if (body === null) return { ok: true, text: "", bytes: 0 };

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>;
      try {
        step = await reader.read();
      } catch {
        return { ok: false, reason: "interrupted" };
      }
      if (step.done) break;
      total += step.value.byteLength;
      if (total > maxBytes) {
        // Stop pulling: the rest of the body is never read into memory.
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too-large" };
      }
      chunks.push(step.value);
    }
  } finally {
    // A lock left held would make a later reader of the same body throw; a
    // reader whose stream has already closed releases without complaint.
    try {
      reader.releaseLock();
    } catch {
      // Already released by the stream closing.
    }
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    // `fatal` so a body that is not UTF-8 is refused rather than decoded into
    // replacement characters and then handed to a parser as if it were text.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(joined);
    return { ok: true, text, bytes: total };
  } catch {
    return { ok: false, reason: "encoding" };
  }
}

export type JsonRead =
  | { ok: true; value: unknown; bytes: number }
  | { ok: false; reason: BodyRefusal | "empty" | "malformed" };

/**
 * Read and parse a JSON body within `maxBytes`.
 *
 * The parser only ever sees text that is already inside the bound, so a body
 * that is "valid JSON, but 4 MiB of it" is refused as too large before
 * `JSON.parse` is reached at all.
 */
export async function readJsonWithin(request: Request, maxBytes: number): Promise<JsonRead> {
  const read = await readBodyWithin(request, maxBytes);
  if (!read.ok) return read;
  if (read.text.length === 0) return { ok: false, reason: "empty" };
  try {
    return { ok: true, value: JSON.parse(read.text) as unknown, bytes: read.bytes };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/** Whether a request declares a JSON body at all. */
export function isJsonRequest(headers: Headers): boolean {
  const type = headers.get("content-type")?.trim().toLowerCase() ?? "";
  return type === "application/json" || type.startsWith("application/json;");
}
