/**
 * A reopened session's history, over Streamable HTTP, where the answer to `session/load` and the
 * history it replays come on different streams: the agent's count in the answer, and the client
 * holding the call until its handlers have run for that many, or, with the SDK's agent, which
 * sends no count, until the history stops arriving.
 */

import { describe, expect, test } from "bun:test";
import http from "node:http";
import * as acp from "@agentclientprotocol/sdk";
import { createNodeHttpHandler } from "@agentclientprotocol/sdk/experimental/node";
import { AcpServer } from "@agentclientprotocol/sdk/experimental/server";
import { Effect, Layer, Logger, type Scope } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Agent from "./agent.ts";
import * as Client from "./client.ts";
import * as Http from "./http.ts";
import type { Wire } from "./json-rpc.ts";
import { logKeys } from "./log-keys.ts";
import { decode } from "./negotiation-test-agent.ts";
import * as Protocol from "./protocol.ts";
import { replayedKey } from "./replay.ts";
import * as V1 from "./schema/v1.gen.ts";

const info = { name: "replay-test", version: "1.0.0" };
const REPLAYED = 30;

/** `serve` on `Bun.serve`, port 0. */
const hostServe = (onConnection: (wire: Wire) => Effect.Effect<void, never, Scope.Scope>) => {
  const web = HttpRouter.toWebHandler(Http.serve({ onConnection }), { disableLogger: true });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => web.handler(request) });
  return {
    url: `http://127.0.0.1:${server.port}/acp`,
    stop: async () => {
      await web.dispose();
      await server.stop(true);
    },
  };
};

/** An agent on this library whose `session/load` replays `REPLAYED` updates. */
const replayingAgent = Agent.implement(Protocol.v1, {
  capabilities: { loadSession: true },
  handlers: (connection) =>
    Effect.succeed({
      "session/new": () => Effect.succeed({ sessionId: V1.SessionId.make("session-1") }),
      "session/load": ({ sessionId }) =>
        Effect.gen(function* () {
          for (let i = 0; i < REPLAYED; i++) {
            yield* connection
              .notify(
                "session/update",
                decode(V1.SessionNotification, {
                  sessionId,
                  update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `${i}` } },
                }),
              )
              .pipe(Effect.orDie);
          }
          return {};
        }),
    }),
});

/** A client whose update handler takes a moment, and counts what it has handled. */
const countingClient = (handled: { count: number }) =>
  Client.implement(Protocol.v1, {
    capabilities: {},
    handlers: () =>
      Effect.succeed({
        "session/update": () => Effect.sleep("1 millis").pipe(Effect.andThen(Effect.sync(() => (handled.count += 1)))),
      }),
  });

const capture = () => {
  const logged: Array<{ readonly level: string; readonly message: ReadonlyArray<unknown> }> = [];
  const layer = Logger.layer([
    Logger.make((options) => logged.push({ level: options.logLevel, message: options.message as ReadonlyArray<unknown> })),
  ]);
  return { logged, layer };
};

describe("a reopened session's history", () => {
  test("AN16 AN17: over HTTP, the agent's answer to session/load says how many updates it replayed, and the client's call completes once its handler has run for all of them", async () => {
    const host = hostServe((wire) =>
      Agent.run({ wire, info, implementations: [replayingAgent] }).pipe(Effect.provide(Logger.layer([]))),
    );
    const handled = { count: 0 };
    const { logged, layer } = capture();
    try {
      const atAnswer = await Effect.runPromise(
        Effect.gen(function* () {
          const wire = yield* Http.connect(host.url);
          const connection = yield* Client.connect({ wire, info, implementations: [countingClient(handled)] });
          const answer = yield* connection.agent["session/load"]({
            sessionId: V1.SessionId.make("session-1"),
            cwd: "/tmp",
            mcpServers: [],
          });
          return { answer, handled: handled.count };
        }).pipe(Effect.scoped, Effect.provide(Layer.merge(FetchHttpClient.layer, layer))),
      );
      expect(atAnswer.answer._meta).toEqual({ [replayedKey]: REPLAYED });
      expect(atAnswer.handled).toBe(REPLAYED);
      expect(logged.filter((entry) => entry.level === "Warn")).toEqual([]);
    } finally {
      await host.stop();
    }
  });

  test("AN17: with the SDK's agent, whose answer carries no count, the client's call completes once the history has stopped arriving, and says so in a warning", async () => {
    const server = new AcpServer({
      createAgent: () =>
        acp
          .agent({ name: "an-sdk-agent" })
          .onRequest("initialize", () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }))
          .onRequest("session/load", async (c) => {
            for (let i = 0; i < REPLAYED; i++) {
              await c.client.notify("session/update", {
                sessionId: c.params.sessionId,
                update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `${i}` } },
              });
            }
            return {};
          }),
    });
    const web = http.createServer(createNodeHttpHandler(server));
    const listening = Promise.withResolvers<void>();
    web.listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    const address = web.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const handled = { count: 0 };
    const { logged, layer } = capture();
    try {
      const atAnswer = await Effect.runPromise(
        Effect.gen(function* () {
          const wire = yield* Http.connect(`http://127.0.0.1:${port}/acp`);
          const connection = yield* Client.connect({ wire, info, implementations: [countingClient(handled)] });
          yield* connection.agent["session/load"]({ sessionId: V1.SessionId.make("sdk-1"), cwd: "/tmp", mcpServers: [] });
          return handled.count;
        }).pipe(Effect.scoped, Effect.provide(Layer.merge(FetchHttpClient.layer, layer))),
      );
      expect(atAnswer).toBe(REPLAYED);
      expect(logged.filter((entry) => entry.message[0] === logKeys.replay.waitedForQuiet)).toEqual([
        {
          level: "Warn",
          message: [logKeys.replay.waitedForQuiet, { sessionId: "sdk-1", handled: REPLAYED, waitedMs: expect.any(Number) }],
        },
      ]);
    } finally {
      await server.close();
      web.closeAllConnections();
      const closed = Promise.withResolvers<void>();
      web.close(() => closed.resolve());
      await closed.promise;
    }
  });
});
