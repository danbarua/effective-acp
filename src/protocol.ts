/**
 * ACP's protocol versions, modelled on Effect's `McpProtocol`: one `ProtocolAdapter` per version,
 * holding that version's method sets, how it writes and reads `initialize`, and its capability
 * gates.
 *
 * A gate says, for a method and its params under the profile both ends negotiated, whether the
 * method may be sent. A refusal names the capability the method or its params need, as the path of
 * that capability in the `initialize` message that advertises it (`agentCapabilities.loadSession` in
 * version 1, `capabilities.session.delete` in version 2), and says whether the method itself needs
 * it (`needs: "method"`, answered -32601) or only these params do (`needs: "params"`, -32602).
 *
 * A capability counts as advertised when it is present and neither `null` nor `false`: version 1's
 * booleans must be `true`, and object capabilities must be objects (`{}` advertises). The client's
 * `elicitation: {}` advertises no mode: only a non-null `form` or `url` does.
 */

import { Data, Predicate, Schema } from "effect";
import { allowed, at, authMethodGate, elicitationGate, gateWith, isUpdate, listAt, need, offeredAuthMethods, promptGate, sessionSetupGate, typeOf } from "./gates.ts";
import { ErrorCode, JsonRpcError } from "./json-rpc.ts";
import type * as Methods from "./methods.ts";
import * as V1 from "./schema/v1.gen.ts";
import * as V1Rpcs from "./schema/v1.rpcs.gen.ts";
import type * as V2 from "./schema/v2.gen.ts";
import type * as V2Rpcs from "./schema/v2.rpcs.gen.ts";

/** The protocol versions built here. */
export type ProtocolVersion = 1 | 2;

/** The types one protocol version names. */
export interface Version {
  readonly protocolVersion: ProtocolVersion;
  readonly agentRequests: Methods.Any;
  readonly agentNotifications: Methods.Any;
  readonly clientRequests: Methods.Any;
  readonly clientNotifications: Methods.Any;
  readonly agentCapabilities: object;
  readonly clientCapabilities: object;
  readonly authMethod: unknown;
  readonly implementation: object;
  readonly initializeRequest: object;
  readonly initializeResponse: object;
}

export interface V1Version {
  readonly protocolVersion: 1;
  readonly agentRequests: Methods.Of<typeof V1Rpcs.AgentRequests>;
  readonly agentNotifications: Methods.Of<typeof V1Rpcs.AgentNotifications>;
  readonly clientRequests: Methods.Of<typeof V1Rpcs.ClientRequests>;
  readonly clientNotifications: Methods.Of<typeof V1Rpcs.ClientNotifications>;
  readonly agentCapabilities: V1.AgentCapabilities;
  readonly clientCapabilities: V1.ClientCapabilities;
  readonly authMethod: V1.AuthMethod;
  readonly implementation: V1.Implementation;
  readonly initializeRequest: V1.InitializeRequest;
  readonly initializeResponse: V1.InitializeResponse;
}

export interface V2Version {
  readonly protocolVersion: 2;
  readonly agentRequests: Methods.Of<typeof V2Rpcs.AgentRequests>;
  readonly agentNotifications: Methods.Of<typeof V2Rpcs.AgentNotifications>;
  readonly clientRequests: Methods.Of<typeof V2Rpcs.ClientRequests>;
  readonly clientNotifications: Methods.Of<typeof V2Rpcs.ClientNotifications>;
  readonly agentCapabilities: V2.AgentCapabilities;
  readonly clientCapabilities: V2.ClientCapabilities;
  readonly authMethod: V2.AuthMethod;
  readonly implementation: V2.Implementation;
  readonly initializeRequest: V2.InitializeRequest;
  readonly initializeResponse: V2.InitializeResponse;
}

/** What both ends said of themselves at `initialize`, in the negotiated version's types. */
export interface Profile<V extends Version> {
  readonly protocolVersion: V["protocolVersion"];
  readonly client: {
    readonly capabilities: V["clientCapabilities"];
    readonly info: V["implementation"] | undefined;
  };
  readonly agent: {
    readonly capabilities: V["agentCapabilities"];
    readonly info: V["implementation"] | undefined;
    readonly authMethods: ReadonlyArray<V["authMethod"]>;
  };
}

/** Which way a method goes: `toAgent` for what the client sends and the agent serves, `toClient` the reverse. */
export type Direction = "toAgent" | "toClient";

export type Gate =
  | { readonly _tag: "Allowed" }
  | {
      readonly _tag: "Refused";
      /** The capability, as its path in the `initialize` message that would advertise it. */
      readonly capability: string;
      /** Whether the method itself needs the capability, or only these params do. */
      readonly needs: "method" | "params";
      readonly message: string;
    };

export type Refused = Extract<Gate, { readonly _tag: "Refused" }>;

export interface ProtocolAdapter<V extends Version> {
  readonly protocolVersion: V["protocolVersion"];
  /**
   * `stable` for a released protocol version, `experimental` for a draft. The SDK's main entry is
   * version 1 only, and its draft of version 2 is under `experimental/v2`.
   */
  readonly stability: "stable" | "experimental";
  /** The requests the agent serves, `initialize` included. */
  readonly agentRequests: Methods.MethodSet<V["agentRequests"]>;
  readonly agentNotifications: Methods.MethodSet<V["agentNotifications"]>;
  readonly clientRequests: Methods.MethodSet<V["clientRequests"]>;
  readonly clientNotifications: Methods.MethodSet<V["clientNotifications"]>;
  /** The methods whose definitions are marked **UNSTABLE**. */
  readonly unstable: ReadonlySet<string>;
  /** `initialize`'s params and result, between their JSON and this version's types. */
  readonly initializeCodec: {
    readonly request: Schema.Codec<V["initializeRequest"], unknown>;
    readonly response: Schema.Codec<V["initializeResponse"], unknown>;
  };
  /** `initialize`'s params as a client of this version sends them. */
  readonly initializeRequest: (client: {
    readonly capabilities: V["clientCapabilities"];
    readonly info: V["implementation"];
  }) => V["initializeRequest"];
  /** `initialize`'s result as an agent of this version answers it. */
  readonly initializeResponse: (agent: {
    readonly capabilities: V["agentCapabilities"];
    readonly info: V["implementation"];
    readonly authMethods: ReadonlyArray<V["authMethod"]>;
  }) => V["initializeResponse"];
  /**
   * The auth methods an agent answers the client that sent `request` with: `authMethods` without
   * those of type `terminal`, unless the client advertised terminal auth.
   */
  readonly offeredAuthMethods: (
    request: V["initializeRequest"],
    authMethods: ReadonlyArray<V["authMethod"]>,
  ) => ReadonlyArray<V["authMethod"]>;
  /** The profile an `initialize` request and its result negotiated. */
  readonly profile: (request: V["initializeRequest"], response: V["initializeResponse"]) => Profile<V>;
  /** The gate on the method alone, whatever its params. */
  readonly methodGate: (direction: Direction, method: string, profile: Profile<V>) => Gate;
  /** The gate on the method and its params (decoded, or as the caller passes them). */
  readonly gate: (direction: Direction, method: string, params: unknown, profile: Profile<V>) => Gate;
}

// oxlint-disable-next-line typescript/no-explicit-any -- any version's adapter, as a list of them holds it
export type AnyAdapter = ProtocolAdapter<any>;

/**
 * The version an agent answers: `offered` when it is in `supported`, otherwise the highest in
 * `supported`. ACP's rule: the answer is always a version, never an error; a client that cannot
 * speak it closes the connection.
 */
export const select = (supported: readonly [number, ...Array<number>], offered: number): number =>
  supported.includes(offered) ? offered : Math.max(...supported);

/**
 * The `protocolVersion` of an `initialize` request's params or of its result, read the same way in
 * every version (an integer from 0 to 65535), or undefined when there is none.
 */
export const readProtocolVersion = (value: unknown): number | undefined => {
  const version = Predicate.isObject(value) ? value["protocolVersion"] : undefined;
  return typeof version === "number" && Number.isInteger(version) && version >= 0 && version <= 65535
    ? version
    : undefined;
};

/** A method the other end has not advertised it can take, refused before anything was sent. */
export class CapabilityNotAdvertised extends Data.TaggedError("CapabilityNotAdvertised")<{
  readonly method: string;
  readonly capability: string;
  readonly message: string;
}> {}

/** The JSON-RPC error a refusal answers an incoming request with: -32601 or -32602, naming the capability. */
export const refusalError = (refused: Refused): JsonRpcError =>
  new JsonRpcError({
    code: refused.needs === "method" ? ErrorCode.MethodNotFound : ErrorCode.InvalidParams,
    message: refused.message,
    data: { capability: refused.capability },
  });

/** ACP reserves method names that start with `_` for extensions. No gate stands in front of them. */
export const isExtensionMethod = (method: string): boolean => method.startsWith("_");

const v1MethodGate = (direction: Direction, method: string, profile: Profile<V1Version>): Gate => {
  if (isExtensionMethod(method)) return allowed;
  const agent = (path: ReadonlyArray<string>) =>
    need(profile.agent.capabilities, "agentCapabilities", path, "method", method);
  const client = (path: ReadonlyArray<string>) =>
    need(profile.client.capabilities, "clientCapabilities", path, "method", method);
  if (direction === "toAgent") {
    const session = method.startsWith("session/") ? method.slice("session/".length) : undefined;
    if (method === "session/load") return agent(["loadSession"]);
    if (session === "resume" || session === "close" || session === "list" || session === "delete" || session === "fork")
      return agent(["sessionCapabilities", session]);
    if (method === "logout") return agent(["auth", "logout"]);
    if (method === "mcp/message") return agent(["mcpCapabilities", "acp"]);
    if (method.startsWith("providers/")) return agent(["providers"]);
    if (method.startsWith("nes/")) return agent(["nes"]);
    if (method.startsWith("document/")) return agent(["nes", "events", "document", method.slice("document/".length)]);
    return allowed;
  }
  if (method === "fs/read_text_file") return client(["fs", "readTextFile"]);
  if (method === "fs/write_text_file") return client(["fs", "writeTextFile"]);
  if (method.startsWith("terminal/")) return client(["terminal"]);
  if (method === "elicitation/complete") return client(["elicitation", "url"]);
  if (method.startsWith("mcp/")) return agent(["mcpCapabilities", "acp"]);
  return allowed;
};

const v1ParamsGate = (direction: Direction, method: string, params: unknown, profile: Profile<V1Version>): Gate => {
  const agent = (path: ReadonlyArray<string>, why: string) =>
    need(profile.agent.capabilities, "agentCapabilities", path, "params", why);
  const client = (path: ReadonlyArray<string>, why: string) =>
    need(profile.client.capabilities, "clientCapabilities", path, "params", why);
  if (direction === "toAgent") {
    switch (method) {
      case "authenticate":
        return authMethodGate(method, params, profile.agent.authMethods, "id");
      case "session/prompt":
        return promptGate(method, params, (capability, why) => agent(["promptCapabilities", capability], why));
      case "session/new":
      case "session/load":
      case "session/resume":
      case "session/fork":
        return sessionSetupGate(
          method,
          params,
          (why) => agent(["sessionCapabilities", "additionalDirectories"], why),
          (type, why) =>
            type === "http" || type === "sse" || type === "acp" ? agent(["mcpCapabilities", type], why) : allowed,
        );
      default:
        return allowed;
    }
  }
  if (method === "elicitation/create")
    return elicitationGate(method, params, (mode, why) => client(["elicitation", mode], why));
  if (method !== "session/update") return allowed;
  const why = `session/update of kind ${JSON.stringify(at(params, ["update", "sessionUpdate"]))}`;
  if (isUpdate(params, "plan_update", "plan_removed")) return client(["plan"], why);
  if (isUpdate(params, "notice")) return client(["session", "notices"], why);
  if (isUpdate(params, "compaction_update", "compaction_summary_chunk")) return client(["session", "compaction"], why);
  if (isUpdate(params, "config_option_update")) {
    const options = listAt(at(params, ["update"]), "configOptions");
    if (options.some((option) => typeOf(option) === "boolean"))
      return client(["session", "configOptions", "boolean"], `${why} with a boolean option`);
  }
  return allowed;
};

/**
 * ACP version 1, the stable protocol. `initialize` carries `clientCapabilities` and `clientInfo`,
 * and its result `agentCapabilities`, `agentInfo` and `authMethods`.
 */
export const v1: ProtocolAdapter<V1Version> = {
  protocolVersion: 1,
  stability: "stable",
  agentRequests: V1Rpcs.AgentRequests,
  agentNotifications: V1Rpcs.AgentNotifications,
  clientRequests: V1Rpcs.ClientRequests,
  clientNotifications: V1Rpcs.ClientNotifications,
  unstable: V1Rpcs.unstable,
  initializeCodec: {
    request: Schema.toCodecJson(V1.InitializeRequest),
    response: Schema.toCodecJson(V1.InitializeResponse),
  },
  initializeRequest: ({ capabilities, info }) => ({ protocolVersion: 1, clientCapabilities: capabilities, clientInfo: info }),
  initializeResponse: ({ capabilities, info, authMethods }) => ({
    protocolVersion: 1,
    agentCapabilities: capabilities,
    agentInfo: info,
    authMethods,
  }),
  offeredAuthMethods: (request, authMethods) =>
    offeredAuthMethods(request, ["clientCapabilities", "auth", "terminal"], authMethods),
  profile: (request, response) => ({
    protocolVersion: 1,
    client: { capabilities: request.clientCapabilities ?? {}, info: request.clientInfo ?? undefined },
    agent: {
      capabilities: response.agentCapabilities ?? {},
      info: response.agentInfo ?? undefined,
      authMethods: response.authMethods ?? [],
    },
  }),
  methodGate: v1MethodGate,
  gate: gateWith(v1MethodGate, v1ParamsGate),
};
