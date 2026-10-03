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
bun add github:danbarua/effective-acp#<commit>
```

`effect` is a peer dependency (`^4.0.0`): the application provides it, so the library and the
application share one copy of Effect. The package is TypeScript source, for Bun.

## Modules

| Import | What it is |
|---|---|
| `effective-acp/agent` | An ACP agent: one implementation per protocol version; `run` on a wire, `runStdio` as an editor launches one, `layerHttp` to serve one |
| `effective-acp/client` | An ACP client: one implementation per protocol version, and `connect` on a wire |
| `effective-acp/protocol` | The protocol versions (`v1`, `v2`), each its method sets, its `initialize`, and its capability gates |
| `effective-acp/schema/v1`, `effective-acp/schema/v2` | Each version's schemas, generated; `…/v1.rpcs`, `…/v2.rpcs`: its method sets |
| `effective-acp/stdio` | Wires over newline-delimited JSON, ACP's stdio framing |
| `effective-acp/http` | Streamable HTTP: the agent's end (`serve`) and the client's (`connect`) |
| `effective-acp/peer` | One JSON-RPC 2.0 connection that both serves requests and makes them |
| `effective-acp/endpoint` | What the agent and the client share once `initialize` is answered |
| `effective-acp/methods` | How a method is declared: its name, params schema and result schema |
| `effective-acp/json-rpc` | JSON-RPC's messages and error codes, and the `Wire` |
| `effective-acp/log-keys` | Every event the library logs |

## Develop

```sh
bun install
bun run check        # typecheck, lint, every rule has a test, tests
bun run acp:schema   # regenerate src/schema/*.gen.ts from the installed SDK's JSON Schemas
```

It began as `src/acp` in labkit-effect; its history came with it.
