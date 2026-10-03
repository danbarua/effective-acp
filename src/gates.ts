/**
 * The gates' parts that every protocol version shares: reading a value at a path, whether a
 * capability is advertised, and the gates on params that look the same in every version. Internal:
 * `protocol.ts` and `protocol-v2.ts` build their versions' gates from these.
 */

import { Predicate } from "effect";
import type { Direction, Gate, Profile, Version } from "./protocol.ts";

export const allowed: Gate = { _tag: "Allowed" };

/** The value at `path` under `value`, or undefined where the path leaves objects. */
export const at = (value: unknown, path: ReadonlyArray<string>): unknown =>
  path.reduce<unknown>((current, key) => (Predicate.isObject(current) ? current[key] : undefined), value);

export const listAt = (value: unknown, key: string): ReadonlyArray<unknown> => {
  const list = at(value, [key]);
  return Array.isArray(list) ? list : [];
};

export const typeOf = (value: unknown, key = "type"): unknown => at(value, [key]);

/** A capability is advertised when it is present and neither `null` nor `false`. */
export const isAdvertised = (value: unknown): boolean => value !== undefined && value !== null && value !== false;

/** Refuses unless the capability at `path` under `root` (named `rootName`) is advertised. */
export const need = (
  root: unknown,
  rootName: string,
  path: ReadonlyArray<string>,
  needs: "method" | "params",
  why: string,
): Gate => {
  if (isAdvertised(at(root, path))) return allowed;
  const capability = [rootName, ...path].join(".");
  return { _tag: "Refused", capability, needs, message: `${why} needs ${capability}, which was not advertised` };
};

/** The first refusal, or allowed. */
export const first = (gates: Iterable<() => Gate>): Gate => {
  for (const gate of gates) {
    const result = gate();
    if (result._tag === "Refused") return result;
  }
  return allowed;
};

/** `authMethods` without those of type `terminal`, unless the client advertised terminal auth at `path` under `request`. */
export const offeredAuthMethods = <A>(request: unknown, path: ReadonlyArray<string>, authMethods: ReadonlyArray<A>): ReadonlyArray<A> =>
  isAdvertised(at(request, path))
    ? authMethods
    : authMethods.filter((authMethod) => typeOf(authMethod) !== "terminal");

/** `methodId` must be an advertised method that is not of type `terminal`, which the client runs itself. */
export const authMethodGate = (method: string, params: unknown, authMethods: ReadonlyArray<unknown>, idKey: string): Gate => {
  const methodId = at(params, ["methodId"]);
  const found = authMethods.find((advertisedMethod) => at(advertisedMethod, [idKey]) === methodId);
  if (found !== undefined && typeOf(found) !== "terminal") return allowed;
  return {
    _tag: "Refused",
    capability: "authMethods",
    needs: "params",
    message:
      found === undefined
        ? `${method} names the auth method ${JSON.stringify(methodId)}, which the agent did not advertise`
        : `${method} names the terminal auth method ${JSON.stringify(methodId)}, which the client runs itself`,
  };
};

/** Each prompt block of a type that needs a capability: `image`, `audio`, and `resource` (embedded context). */
export const promptGate = (method: string, params: unknown, check: (capability: string, why: string) => Gate): Gate =>
  first(
    listAt(params, "prompt").map((block) => () => {
      const type = typeOf(block);
      if (type === "image") return check("image", `${method} with an image block`);
      if (type === "audio") return check("audio", `${method} with an audio block`);
      if (type === "resource") return check("embeddedContext", `${method} with an embedded resource block`);
      return allowed;
    }),
  );

/** `additionalDirectories` that is not empty, and each MCP server's transport. */
export const sessionSetupGate = (
  method: string,
  params: unknown,
  additionalDirectories: (why: string) => Gate,
  mcpServer: (type: unknown, why: string) => Gate,
): Gate =>
  first([
    () =>
      listAt(params, "additionalDirectories").length > 0
        ? additionalDirectories(`${method} with additionalDirectories`)
        : allowed,
    ...listAt(params, "mcpServers").map(
      (server) => () => mcpServer(typeOf(server), `${method} with an MCP server of type ${JSON.stringify(typeOf(server))}`),
    ),
  ]);

/** `elicitation/create` in mode `form` or `url` needs that mode advertised; other modes are custom, and no capability names them. */
export const elicitationGate = (method: string, params: unknown, check: (mode: string, why: string) => Gate): Gate => {
  const mode = at(params, ["mode"]);
  return mode === "form" || mode === "url" ? check(mode, `${method} in mode ${mode}`) : allowed;
};

export const isUpdate = (params: unknown, ...kinds: ReadonlyArray<string>): boolean => {
  const kind = at(params, ["update", "sessionUpdate"]);
  return typeof kind === "string" && kinds.includes(kind);
};

export const gateWith =
  <V extends Version>(
    methodGate: (direction: Direction, method: string, profile: Profile<V>) => Gate,
    paramsGate: (direction: Direction, method: string, params: unknown, profile: Profile<V>) => Gate,
  ) =>
  (direction: Direction, method: string, params: unknown, profile: Profile<V>): Gate => {
    const gate = methodGate(direction, method, profile);
    return gate._tag === "Refused" ? gate : paramsGate(direction, method, params, profile);
  };
