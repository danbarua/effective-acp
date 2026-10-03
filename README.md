# effective-acp

The [Agent Client Protocol](https://agentclientprotocol.com) (ACP) on [Effect](https://effect.website)
4: the protocol's schemas, generated from the official SDK's JSON Schemas; a two-way JSON-RPC peer;
the wires a connection runs over (stdio, Streamable HTTP); and an agent and a client that negotiate
the protocol version (1, and the version 2 draft) and each other's capabilities. It is shaped like
Effect's `effect/ai/McpServer`. Its tests drive it with the official SDK
(`@agentclientprotocol/sdk` 1.5.0), which the library itself never imports.

What each part does, and its rules, are in [`src/MODEL.md`](src/MODEL.md); where Effect fits and
where it does not, in [`src/EFFECT-FIT.md`](src/EFFECT-FIT.md).

## Install

```sh
bun add effective-acp effect   # or: npm install effective-acp effect
```

`effect` is a peer dependency (`^4.0.0`): the application provides it, so the library and the
application share one copy of Effect.

Each module is exported with three conditions: `bun` resolves to the TypeScript source, `types` to
the declarations, and `default` to the built JavaScript, for Node and bundlers.

## Modules

| Import | What it is |
|---|---|
| `effective-acp/agent` | An ACP agent: one implementation per protocol version; `run` on a wire, `runStdio` as an editor launches one, `layerHttp` to serve one |
| `effective-acp/client` | An ACP client: one implementation per protocol version, and `connect` on a wire |
| `effective-acp/protocol` | Protocol version 1 (`v1`): its method sets, its `initialize` and its capability gates; and every version's types |
| `effective-acp/protocol/v2` | The version 2 draft (`v2`), opted into by importing it: only then are version 2's schemas loaded |
| `effective-acp/schema/v1`, `effective-acp/schema/v2` | Each version's schemas, generated; `…/v1.rpcs`, `…/v2.rpcs`: its method sets |
| `effective-acp/stdio` | Wires over newline-delimited JSON, ACP's stdio framing |
| `effective-acp/http` | Streamable HTTP: the agent's end (`serve`) and the client's (`connect`) |
| `effective-acp/peer` | One JSON-RPC 2.0 connection that both serves requests and makes them |
| `effective-acp/endpoint` | What the agent and the client share once `initialize` is answered |
| `effective-acp/methods` | How a method is declared: its name, params schema and result schema |
| `effective-acp/json-rpc` | JSON-RPC's messages and error codes, and the `Wire` |
| `effective-acp/log-keys` | Every event the library logs |

## Ids, errors and logs

Ids are branded strings (`V1.SessionId`, `V1.ToolCallId`, `V1.SessionConfigId` and the rest), so
one kind of id cannot be passed where another is meant. An id the other end sent is branded
already. An id that arrives as text, such as from a URL or a file, is branded once where it comes
in: `V1.SessionId.make(text)`.

A call fails with a `JsonRpcError` when the other end answers with an error: an `Error` whose
`message` is the other end's message, with its `code` and `data`. It fails with `PeerClosed` when
the connection ends before the answer, and with `CapabilityNotAdvertised`, before anything is sent,
when the other end did not advertise what the call needs. A handler fails with a `JsonRpcError`, or
with any value shaped like one (`{ code, message, data }`); it goes out as those three fields.

The library logs through Effect's logger. What it drops or replaces is logged as a warning with what
was dropped or replaced: a field that failed to decode and took its default, list items that failed
to decode, a message the other end sent that this end did not advertise it takes, a notification
whose params failed to decode, a handler's failure that no one would otherwise hear. `log-keys`
names every event.

## A reopened session's history

Over Streamable HTTP, the answer to `session/load` and the history it replays come on different
streams, and the transport's RFD does not order them, so the answer can arrive first. An agent built
on this library puts in the answer's `_meta` how many updates it replayed
(`effective-acp/replayed`); a client built on it completes the call once its handlers have run for
that many. With an agent that sends no count, the client waits until the history stops arriving,
and logs that it did.

## Develop

```sh
bun install
bun run check        # typecheck, lint, every rule has a test, tests
bun run build        # dist/: JavaScript and declarations, for Node
bun run acp:schema   # regenerate src/schema/*.gen.ts from the installed SDK's JSON Schemas
```

CI runs the check and the build on every push and pull request. Pushing a tag `v<version>`, where
`<version>` is `package.json`'s, publishes that version to npm (`.github/workflows/release.yml`).

It began as `src/acp` in labkit-effect; its history came with it.

## License

MIT
