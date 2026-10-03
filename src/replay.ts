/**
 * When a reopened session's history has arrived. ACP's Streamable HTTP transport sends the answer
 * to `session/load` on the connection's stream and the history it replays on the session's stream,
 * and nothing orders the two, so the answer can arrive first. An agent built on this library says
 * in the answer's `_meta` how many `session/update`s it sent for the session while answering; a
 * client built on it completes the call once its handlers have run for that many. Internal: the
 * endpoint uses it.
 */

import { Deferred, Effect, Exit, Option, Predicate } from "effect";
import { logKeys } from "./log-keys.ts";

/** The `_meta` key of a `session/load` answer: how many `session/update`s were sent for the session while it was answered. */
export const replayedKey = "effective-acp/replayed";

/** The longest a client waits for the history after the answer, with or without a count. */
const waitLimitMs = 10_000;

/** With no count from the agent, the history is taken as complete once none of it has arrived for this long. */
const quietMs = 300;

const sessionIdOf = (payload: unknown): string | undefined => {
  const id = Predicate.isObject(payload) ? payload["sessionId"] : undefined;
  return typeof id === "string" ? id : undefined;
};

const replayedOf = (answer: unknown): number | undefined => {
  const meta = Predicate.isObject(answer) ? answer["_meta"] : undefined;
  const replayed = Predicate.isObject(meta) ? meta[replayedKey] : undefined;
  return typeof replayed === "number" && Number.isInteger(replayed) && replayed >= 0 ? replayed : undefined;
};

/** The agent's side: counts the updates sent for each session whose `session/load` is being answered. */
export const makeReplayCounter = () => {
  const answering = new Map<string, number>();
  return {
    /** Counts `method` sent with `payload`, if it is an update for a session whose load is being answered. */
    sent: (method: string, payload: unknown): void => {
      const id = method === "session/update" ? sessionIdOf(payload) : undefined;
      const sent = id === undefined ? undefined : answering.get(id);
      if (id !== undefined && sent !== undefined) answering.set(id, sent + 1);
    },
    /** Runs the `session/load` handler's `answer`, and adds to its `_meta` how many updates it sent. */
    answering: <A, E, R>(payload: unknown, answer: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
      const id = sessionIdOf(payload);
      if (id === undefined) return answer;
      return Effect.acquireUseRelease(
        Effect.sync(() => answering.set(id, 0)),
        () =>
          Effect.map(answer, (result) => {
            if (!Predicate.isObject(result)) return result;
            const meta = Predicate.isObject(result["_meta"]) ? result["_meta"] : {};
            return { ...result, _meta: { ...meta, [replayedKey]: answering.get(id) ?? 0 } } as A;
          }),
        () => Effect.sync(() => answering.delete(id)),
      );
    },
  };
};

interface Tally {
  /** How many of the session's updates have had their handler run. */
  count: number;
  /** When the last of them did, in ms since the epoch. */
  last: number;
  waiting: Array<{ readonly target: number; readonly reached: Deferred.Deferred<void> }>;
}

/** The client's side: counts the session updates handled, and holds a `session/load` call until its history has been. */
export const makeReplayWaiter = () => {
  const tallies = new Map<string, Tally>();
  const tallyOf = (id: string): Tally => {
    const known = tallies.get(id);
    if (known !== undefined) return known;
    const tally: Tally = { count: 0, last: 0, waiting: [] };
    tallies.set(id, tally);
    return tally;
  };

  const waitFor = (id: string, before: number, replayed: number): Effect.Effect<void> =>
    Effect.suspend(() => {
      const tally = tallyOf(id);
      const target = before + replayed;
      if (tally.count >= target) return Effect.void;
      const reached = Deferred.makeUnsafe<void>();
      tally.waiting.push({ target, reached });
      return Deferred.await(reached).pipe(
        Effect.timeoutOption(waitLimitMs),
        Effect.flatMap(
          Option.match({
            onSome: () => Effect.void,
            onNone: () =>
              Effect.logWarning(logKeys.replay.incomplete, {
                sessionId: id,
                replayed,
                handled: tally.count - before,
                waitedMs: waitLimitMs,
              }),
          }),
        ),
      );
    });

  const waitForQuiet = (id: string, before: number): Effect.Effect<void> =>
    Effect.gen(function* () {
      const answered = Date.now();
      for (;;) {
        const tally = tallyOf(id);
        const now = Date.now();
        const idle = now - Math.max(tally.last, answered);
        if (idle >= quietMs || now - answered >= waitLimitMs) {
          yield* Effect.logWarning(logKeys.replay.waitedForQuiet, {
            sessionId: id,
            handled: tally.count - before,
            waitedMs: now - answered,
          });
          return;
        }
        yield* Effect.sleep(quietMs - idle);
      }
    });

  return {
    /** Counts `method` with `payload` once its handler has run, if it is a session update. */
    handled: (method: string, payload: unknown): void => {
      const id = method === "session/update" ? sessionIdOf(payload) : undefined;
      if (id === undefined) return;
      const tally = tallyOf(id);
      tally.count += 1;
      tally.last = Date.now();
      tally.waiting = tally.waiting.filter((waiter) => {
        if (tally.count < waiter.target) return true;
        Deferred.doneUnsafe(waiter.reached, Exit.void);
        return false;
      });
    },
    /**
     * Runs the `session/load` `call`, then waits until the history it replayed has been handled: as
     * many updates as the answer's count says, or, with no count, until none has arrived for a while.
     */
    loading: <A, E>(payload: unknown, call: Effect.Effect<A, E>): Effect.Effect<A, E> => {
      const id = sessionIdOf(payload);
      if (id === undefined) return call;
      return Effect.gen(function* () {
        const before = tallyOf(id).count;
        const answer = yield* call;
        const replayed = replayedOf(answer);
        yield* replayed === undefined ? waitForQuiet(id, before) : waitFor(id, before, replayed);
        return answer;
      });
    },
  };
};
