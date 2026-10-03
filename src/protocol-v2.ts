/**
 * ACP version 2, the SDK's draft, as an adapter. Opt in by importing it
 * (`effective-acp/protocol/v2`): only then are version 2's schemas loaded.
 */

import { Schema } from "effect";
import { allowed, authMethodGate, elicitationGate, gateWith, need, offeredAuthMethods, promptGate, sessionSetupGate } from "./gates.ts";
import { type Direction, type Gate, isExtensionMethod, type Profile, type ProtocolAdapter, type V2Version } from "./protocol.ts";
import * as V2 from "./schema/v2.gen.ts";
import * as V2Rpcs from "./schema/v2.rpcs.gen.ts";

const v2MethodGate = (direction: Direction, method: string, profile: Profile<V2Version>): Gate => {
  if (isExtensionMethod(method)) return allowed;
  const agent = (path: ReadonlyArray<string>) => need(profile.agent.capabilities, "capabilities", path, "method", method);
  const client = (path: ReadonlyArray<string>) => need(profile.client.capabilities, "capabilities", path, "method", method);
  if (direction === "toAgent") {
    const session = method.startsWith("session/") ? method.slice("session/".length) : undefined;
    if (session !== undefined) {
      const surface = agent(["session"]);
      if (surface._tag === "Refused") return surface;
      return session === "delete" || session === "fork" ? agent(["session", session]) : allowed;
    }
    if (method === "auth/login" || method === "auth/logout")
      return profile.agent.authMethods.length > 0
        ? allowed
        : {
            _tag: "Refused",
            capability: "authMethods",
            needs: "method",
            message: `${method} needs authMethods, which the agent left empty`,
          };
    if (method === "mcp/message") return agent(["session", "mcp", "acp"]);
    if (method.startsWith("providers/")) return agent(["providers"]);
    if (method.startsWith("nes/")) return agent(["nes"]);
    if (method.startsWith("document/")) return agent(["nes", "events", "document", method.slice("document/".length)]);
    return allowed;
  }
  if (method === "elicitation/complete") return client(["elicitation", "url"]);
  if (method.startsWith("mcp/")) return agent(["session", "mcp", "acp"]);
  return allowed;
};

const v2ParamsGate = (direction: Direction, method: string, params: unknown, profile: Profile<V2Version>): Gate => {
  const agent = (path: ReadonlyArray<string>, why: string) =>
    need(profile.agent.capabilities, "capabilities", path, "params", why);
  const client = (path: ReadonlyArray<string>, why: string) =>
    need(profile.client.capabilities, "capabilities", path, "params", why);
  if (direction === "toClient")
    return method === "elicitation/create"
      ? elicitationGate(method, params, (mode, why) => client(["elicitation", mode], why))
      : allowed;
  switch (method) {
    case "auth/login":
      return authMethodGate(method, params, profile.agent.authMethods, "methodId");
    case "session/prompt":
      return promptGate(method, params, (capability, why) => agent(["session", "prompt", capability], why));
    case "session/new":
    case "session/resume":
    case "session/fork":
      return sessionSetupGate(
        method,
        params,
        (why) => agent(["session", "additionalDirectories"], why),
        (type, why) =>
          type === "http" || type === "stdio" || type === "acp" ? agent(["session", "mcp", type], why) : allowed,
      );
    default:
      return allowed;
  }
};

/**
 * ACP version 2, the SDK's draft. `initialize` carries `capabilities` and `info` both ways, and its
 * result `authMethods`, which is left out when empty.
 */
export const v2: ProtocolAdapter<V2Version> = {
  protocolVersion: 2,
  stability: "experimental",
  agentRequests: V2Rpcs.AgentRequests,
  agentNotifications: V2Rpcs.AgentNotifications,
  clientRequests: V2Rpcs.ClientRequests,
  clientNotifications: V2Rpcs.ClientNotifications,
  unstable: V2Rpcs.unstable,
  initializeCodec: {
    request: Schema.toCodecJson(V2.InitializeRequest),
    response: Schema.toCodecJson(V2.InitializeResponse),
  },
  initializeRequest: ({ capabilities, info }) => ({ protocolVersion: 2, capabilities, info }),
  initializeResponse: ({ capabilities, info, authMethods }) => ({
    protocolVersion: 2,
    capabilities,
    info,
    ...(authMethods.length > 0 ? { authMethods } : {}),
  }),
  offeredAuthMethods: (request, authMethods) => offeredAuthMethods(request, ["capabilities", "auth", "terminal"], authMethods),
  profile: (request, response) => ({
    protocolVersion: 2,
    client: { capabilities: request.capabilities ?? {}, info: request.info },
    agent: { capabilities: response.capabilities ?? {}, info: response.info, authMethods: response.authMethods ?? [] },
  }),
  methodGate: v2MethodGate,
  gate: gateWith(v2MethodGate, v2ParamsGate),
};
