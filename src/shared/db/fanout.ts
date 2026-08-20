/**
 * One route's *enrichment* fan-out, bounded by the same budget every other
 * fan-out here spends — {@link DatabaseBudget.fanout}.
 *
 * **Why this exists beside `collectWithConcurrency`.** That helper bounds a walk
 * over a *list*: many units of one shape, where the length is data. An
 * enrichment phase is the other shape — a handful of *named, differently typed*
 * reads decorating an answer already computed — and the idiom for it is
 * `Promise.all([a(), b(), c(), …])`, which is exactly the unbounded fan-out the
 * budget exists to prevent, wearing a fixed length so it reads as harmless. It
 * isn't: `/api/adp` finished its aggregate and then opened five more connections
 * at once against a budget of three, so one reader held half the default pool
 * *after* the expensive part of its work was over.
 *
 * So the tasks are named rather than positional (a destructured object reads
 * like the `Promise.all` it replaces, with no index to keep in step), and the
 * walk underneath is `collectWithConcurrency` rather than a second limiter of
 * its own.
 *
 * **Three properties are the whole of the contract**, and each is a failure this
 * shape has already had somewhere in this codebase:
 *
 * - **Every task is started**, including after another has failed. The
 *   `Promise.all` this replaces started them all at once, so a version that
 *   stopped at the first rejection would be a behaviour change hiding inside a
 *   performance fix.
 * - **A rejection gives its slot back**, immediately and to the next queued
 *   task. A worker that dies on a throw is a limiter that tightens by one per
 *   database blip — the `sleeper/limiter` lesson, which is why the failure is
 *   caught *inside* the worker and re-thrown at the end.
 * - **The first rejection is the one thrown**, chronologically, which is what
 *   `Promise.all` reports. Every caller's error handling — 503 for a busy
 *   database, 500 for a broken read — is a function of *which* error arrives.
 *
 * **What it must not become is a second admission.** The bound here is
 * per-request and holds nothing process-wide; a task whose loader takes the
 * shared heavy-read admission (`getDraftAuctionSpend` does) queues on that
 * *inside* its slot, which is safe precisely because nothing holding a heavy
 * slot ever waits on a route's private one. Taking a heavy-read token here
 * instead would be the same limiter acquired twice — a deadlock at the limit
 * rather than a slow page, the shape `db/heavy-admission` is written against.
 *
 * Pure and dependency-free beyond the two modules it composes, both of which are
 * themselves pure, so the concurrency it promises is testable with no pool
 * behind it.
 */

import { collectWithConcurrency } from "../util/concurrency.ts";
import { databaseBudget } from "./budget.ts";

/**
 * Where a task's answer comes from, and therefore whether it is bounded.
 *
 * **Declared rather than inferred**, because it cannot be inferred: a loader
 * that answers from a process cache on a hit and queries on a miss looks
 * identical from here. The declaration is what the caller knows and the limiter
 * doesn't — and it is deliberately the *conservative* thing to state, since
 * `"database"` on work that turns out to be cached costs a little needless
 * ordering, where `"memory"` on work that queries is the bound quietly not
 * holding.
 */
export type EnrichmentSource =
  /** Reads Postgres — counts against the fan-out budget. */
  | "database"
  /** Answered from memory or another process's budget — never queued here. */
  | "memory";

/** One named enrichment: what it reads, and how to load it. */
export type Enrichment<T> = {
  source: EnrichmentSource;
  load: () => Promise<T>;
};

/** A database-backed enrichment — the one that spends the budget. */
export function dbRead<T>(load: () => Promise<T>): Enrichment<T> {
  return { source: "database", load };
}

/**
 * An enrichment that reaches no database — a process cache, a pure derivation,
 * an upstream call with a limiter of its own.
 *
 * Unbounded on purpose: serialising work that never takes a connection is
 * latency bought for nothing, which is the mistake a limiter wrapped around
 * "everything the route does next" makes.
 */
export function memoryRead<T>(load: () => Promise<T>): Enrichment<T> {
  return { source: "memory", load };
}

/** The tasks, keyed by the name their answer arrives under. */
export type EnrichmentSet = Record<string, Enrichment<unknown>>;

/** What {@link loadEnrichments} resolves with: one field per task, its own type. */
export type EnrichmentResults<T extends EnrichmentSet> = {
  [K in keyof T]: T[K] extends Enrichment<infer R> ? R : never;
};

/**
 * Run every task, with at most `limit` of the database-backed ones in flight.
 *
 * `limit` defaults to the budget rather than to a number of this module's own,
 * so a deployment that widens `DATABASE_POOL_MAX` widens this with it and there
 * is no second constant to remember. It is an argument at all so the tests can
 * drive the bound at a width they can assert — a shared budget's claim is about
 * what happens *at* the limit, which is not a claim you can make against
 * whatever the environment resolves to.
 *
 * Rejects with the first error to arrive, after every task has settled. Waiting
 * costs a failing request the time of its slowest enrichment, and buys the
 * property above: a slot released rather than abandoned, and no task left
 * running past the response with nobody holding its rejection.
 */
export async function loadEnrichments<T extends EnrichmentSet>(
  tasks: T,
  limit: number = databaseBudget().fanout,
): Promise<EnrichmentResults<T>> {
  const entries = Object.entries(tasks);
  const results: Record<string, unknown> = {};
  // The first rejection *chronologically*, which is the one `Promise.all` would
  // have reported — not the first in declaration order, which would make the
  // error a fact about how the object literal was written.
  let failed = false;
  let failure: unknown;

  const settle = async ([key, task]: [string, Enrichment<unknown>]) => {
    try {
      results[key] = await task.load();
    } catch (error) {
      if (!failed) {
        failed = true;
        failure = error;
      }
    }
  };

  const database = entries.filter(([, task]) => task.source === "database");
  const memory = entries.filter(([, task]) => task.source === "memory");

  await Promise.all([
    // Started before the walk and never queued behind it: this is work that
    // takes no connection, so holding it back would be pure latency.
    ...memory.map(settle),
    collectWithConcurrency(database, limit, settle),
  ]);

  if (failed) throw failure;
  return results as EnrichmentResults<T>;
}
