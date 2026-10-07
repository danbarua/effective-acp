/**
 * Every event acp logs, by the area that logs it. The key is the event's name in the log:
 * `<area>.<subject>.<what happened>`.
 */

export const logKeys = {
  initialize: {
    /** `initialize` was answered: the details name the side, the version offered and the version chosen. */
    negotiated: "acp.initialize.negotiated",
  },
  schema: {
    /** A field the other end sent failed to decode, and the schema replaced it with its default or left it out. */
    fieldReplaced: "acp.schema.field_replaced",
    /** Items of a list the other end sent failed to decode, and were dropped from it: the details name each one. */
    itemsDropped: "acp.schema.items_dropped",
  },
  peer: {
    /** A call's result was `null`, which its schema refuses, and the caller got `{}` instead. */
    nullResult: "acp.peer.null_result",
    /** A notification was dropped: no handler serves its method, or its params failed to decode. */
    notificationDropped: "acp.peer.notification_dropped",
    /** A notification's handler failed or died; there is no one to answer. */
    notificationFailed: "acp.peer.notification_failed",
    /** A request's handler failed with something other than a JSON-RPC error, or died; the request was answered -32603. */
    handlerFailed: "acp.peer.handler_failed",
    /** A response arrived whose id matches no pending call, and was ignored. */
    responseIgnored: "acp.peer.response_ignored",
  },
  replay: {
    /** A `session/load` answer said how many updates were replayed, and not that many had been handled when the client stopped waiting. */
    incomplete: "acp.replay.incomplete",
    /** A `session/load` answer carried no count, so the client waited until the session's updates stopped arriving. */
    waitedForQuiet: "acp.replay.waited_for_quiet",
  },
  http: {
    /** `serve` ended a connection that had no event stream open for `abandonedAfter`, as DELETE ends one. */
    connectionAbandoned: "acp.http.connection_abandoned",
  },
  gate: {
    /** A request or notification from the other end needed a capability that was not advertised; it was answered with an error, or dropped. */
    refusedIncoming: "acp.gate.refused_incoming",
    /** A request or notification this end was about to send needed a capability the other end did not advertise; nothing was sent. */
    refusedLocally: "acp.gate.refused_locally",
  },
} as const;
