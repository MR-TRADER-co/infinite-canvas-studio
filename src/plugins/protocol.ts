/**
 * Versioned host↔plugin bridge protocol (R9.2).
 *
 * EVERY byte crossing the sandbox boundary is one of the message shapes
 * declared here. The wire format is JSON over `postMessage` (browser
 * sandboxes) or an in-process channel (tests); both run the SAME
 * {@link RpcPeer} state machine, so the protocol itself is
 * transport-agnostic.
 *
 * Message families:
 * - `hello`  — the host hands the plugin its identity + SDK version; the
 *   plugin answers `ready` (handshake completed) — everything before
 *   `ready` is undefined behaviour the host treats as a startup failure.
 * - `req`    — an RPC request (either direction) awaiting `res`.
 * - `res`    — the response: `{ok: true, result}` or `{ok: false, error:
 *   {code, message}}` (the typed error contract the SDK surfaces).
 * - `evt`    — a one-way push (either direction): app events down, plugin
 *   notifications (command invocations) up.
 *
 * Error codes are stable strings — the SDK maps them to typed errors and
 * Persian user messages where they surface (AC9.4).
 */

/** The bridge protocol wire version this host speaks. */
export const BRIDGE_PROTOCOL_VERSION = 1;

/** Stable bridge error codes (typed on both sides). */
export type BridgeErrorCode =
  | "permission-denied"
  | "unknown-method"
  | "bad-params"
  | "plugin-dead"
  | "timeout"
  | "crashed"
  | "disallowed-event"
  | "storage-quota";

/** A typed bridge error payload. */
export interface BridgeError {
  readonly code: BridgeErrorCode | (string & {});
  readonly message: string;
}

/** Handshake: host → plugin identity + negotiated SDK major version. */
export interface HelloMessage {
  readonly v: typeof BRIDGE_PROTOCOL_VERSION;
  readonly kind: "hello";
  /** The plugin's owner id (its manifest id). */
  readonly pluginId: string;
  /** The host SDK major version the plugin runs against. */
  readonly sdkMajor: number;
  /** The region id when this bridge serves a UI region (panel/settings). */
  readonly regionId: string | null;
  /** Human-readable host build label (diagnostics). */
  readonly host: string;
}

/** Handshake completion: plugin → host. */
export interface ReadyMessage {
  readonly v: typeof BRIDGE_PROTOCOL_VERSION;
  readonly kind: "ready";
}

/** An RPC request (either direction). */
export interface RequestMessage {
  readonly v: typeof BRIDGE_PROTOCOL_VERSION;
  readonly kind: "req";
  /** Correlation id — the response echoes it. */
  readonly msgId: number;
  /** Dotted method path (e.g. `app.commands.register`). */
  readonly method: string;
  readonly params: unknown;
}

/** An RPC response. */
export interface ResponseMessage {
  readonly v: typeof BRIDGE_PROTOCOL_VERSION;
  readonly kind: "res";
  readonly msgId: number;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: BridgeError;
}

/** A one-way push (either direction). */
export interface EventMessage {
  readonly v: typeof BRIDGE_PROTOCOL_VERSION;
  readonly kind: "evt";
  /** Event name (e.g. `app.event.scene:changed`). */
  readonly event: string;
  readonly payload: unknown;
}

/** Every shape that may cross the bridge. */
export type BridgeMessage =
  HelloMessage | ReadyMessage | RequestMessage | ResponseMessage | EventMessage;

/** A transport carrying raw messages between the two peers. */
export interface BridgeTransport {
  /** Sends one message to the other side. */
  post(message: BridgeMessage): void;
  /**
   * Installs the receive callback (the peer's inbox). Implementations
   * MUST support at most one listener; replacing is allowed.
   *
   * @param listener - invoked for every incoming message.
   * @returns an unsubscribe function.
   */
  onMessage(listener: (message: BridgeMessage) => void): () => void;
}

/** A thrown version of {@link BridgeError}. */
export class BridgeRpcError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "BridgeRpcError";
    this.code = code;
  }
}

/**
 * Structural validation of an incoming message (fail-closed: anything
 * that is not a well-formed protocol message is dropped by the peer —
 * a corrupted frame never crashes either side).
 *
 * @param raw - the parsed value received from the transport.
 * @returns whether it is a well-formed bridge message.
 */
export function isBridgeMessage(raw: unknown): raw is BridgeMessage {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const candidate = raw as Partial<BridgeMessage>;
  if (candidate.v !== BRIDGE_PROTOCOL_VERSION) {
    return false;
  }
  switch (candidate.kind) {
    case "hello":
      return (
        typeof candidate.pluginId === "string" &&
        typeof candidate.sdkMajor === "number" &&
        (candidate.regionId === null ||
          typeof candidate.regionId === "string") &&
        typeof candidate.host === "string"
      );
    case "ready":
      return true;
    case "req":
      return (
        typeof candidate.msgId === "number" &&
        typeof candidate.method === "string" &&
        "params" in candidate
      );
    case "res":
      return (
        typeof candidate.msgId === "number" && typeof candidate.ok === "boolean"
      );
    case "evt":
      return typeof candidate.event === "string" && "payload" in candidate;
    default:
      return false;
  }
}

/** Handler signature for RPC methods registered on a peer. */
export type RpcMethodHandler = (params: unknown) => unknown | Promise<unknown>;

/**
 * The transport-agnostic RPC state machine shared by both sides.
 *
 * Each peer can: call the other side (`call`), serve requests
 * (`handle`), and push one-way events (`emit`). Message ids are
 * monotonic; pending calls reject with a typed {@link BridgeRpcError} on
 * response error or {@link teardown} (a dead plugin never leaves the
 * host hanging — R9.2).
 */
export class RpcPeer {
  private nextMsgId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private methods = new Map<string, RpcMethodHandler>();
  private eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  private torn = false;

  /**
   * @param transport - the raw channel to the other peer.
   * @param label - diagnostics label ("host" or the plugin id).
   */
  public constructor(
    private readonly transport: BridgeTransport,
    private readonly label: string,
  ) {
    this.transport.onMessage((message) => this.receive(message));
  }

  /**
   * Calls a method on the other side.
   *
   * @param method - the dotted method path.
   * @param params - the request parameters (JSON-compatible).
   * @returns the remote result.
   * @throws BridgeRpcError on a remote error or teardown.
   */
  public async call(method: string, params: unknown): Promise<unknown> {
    if (this.torn) {
      throw new BridgeRpcError(
        "plugin-dead",
        `${this.label}: bridge torn down`,
      );
    }
    const msgId = this.nextMsgId;
    this.nextMsgId += 1;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(msgId, { resolve, reject });
      this.transport.post({
        v: BRIDGE_PROTOCOL_VERSION,
        kind: "req",
        msgId,
        method,
        params,
      });
    });
  }

  /**
   * Registers a local method the other side may call.
   *
   * @param method - the dotted method path.
   * @param handler - the implementation.
   */
  public handle(method: string, handler: RpcMethodHandler): void {
    this.methods.set(method, handler);
  }

  /**
   * Pushes a one-way event to the other side.
   *
   * @param event - the event name.
   * @param payload - the event payload.
   */
  public emit(event: string, payload: unknown): void {
    if (this.torn) {
      return;
    }
    this.transport.post({
      v: BRIDGE_PROTOCOL_VERSION,
      kind: "evt",
      event,
      payload,
    });
  }

  /**
   * Subscribes to events pushed from the other side.
   *
   * @param event - the event name.
   * @param listener - invoked with the event payload.
   * @returns an unsubscribe function.
   */
  public on(event: string, listener: (payload: unknown) => void): () => void {
    const set = this.eventListeners.get(event) ?? new Set();
    set.add(listener);
    this.eventListeners.set(event, set);
    return () => {
      set.delete(listener);
    };
  }

  /**
   * Tears the peer down: pending calls reject, future traffic stops.
   */
  public teardown(): void {
    this.torn = true;
    const error = new BridgeRpcError(
      "plugin-dead",
      `${this.label}: plugin sandbox went away`,
    );
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
    this.methods.clear();
    this.eventListeners.clear();
  }

  /**
   * @returns whether the peer was torn down.
   */
  public get isTorn(): boolean {
    return this.torn;
  }

  /**
   * @returns the number of in-flight calls (bridge-log diagnostics).
   */
  public get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * The transport inbox: routes a validated message to its handler.
   *
   * @param message - the incoming message (already validated).
   */
  private receive(message: BridgeMessage): void {
    if (this.torn) {
      return;
    }
    if (message.kind === "req") {
      void this.serveRequest(message);
      return;
    }
    if (message.kind === "res") {
      const waiter = this.pending.get(message.msgId);
      if (waiter === undefined) {
        return;
      }
      this.pending.delete(message.msgId);
      if (message.ok) {
        waiter.resolve(message.result);
      } else {
        const error = message.error ?? {
          code: "unknown-method",
          message: "bridge error without payload",
        };
        waiter.reject(new BridgeRpcError(error.code, error.message));
      }
      return;
    }
    if (message.kind === "evt") {
      const listeners = this.eventListeners.get(message.event);
      if (listeners !== undefined) {
        for (const listener of [...listeners]) {
          listener(message.payload);
        }
      }
    }
    // hello/ready are handshake frames handled by the owners (the host
    // waits for `ready` on its raw transport listener).
  }

  /**
   * Serves one remote request through the registered method table.
   *
   * @param message - the request.
   */
  private async serveRequest(message: RequestMessage): Promise<void> {
    const handler = this.methods.get(message.method);
    if (handler === undefined) {
      this.transport.post({
        v: BRIDGE_PROTOCOL_VERSION,
        kind: "res",
        msgId: message.msgId,
        ok: false,
        error: {
          code: "unknown-method",
          message: `${this.label}: no handler for "${message.method}"`,
        },
      });
      return;
    }
    try {
      const result = await handler(message.params);
      this.transport.post({
        v: BRIDGE_PROTOCOL_VERSION,
        kind: "res",
        msgId: message.msgId,
        ok: true,
        result: result === undefined ? null : result,
      });
    } catch (error) {
      const code = error instanceof BridgeRpcError ? error.code : "bad-params";
      const text = error instanceof Error ? error.message : String(error);
      this.transport.post({
        v: BRIDGE_PROTOCOL_VERSION,
        kind: "res",
        msgId: message.msgId,
        ok: false,
        error: { code, message: text },
      });
    }
  }
}

/**
 * Creates a connected in-process transport pair (tests + the host-side
 * region plumbing): messages posted on one side arrive on the other
 * through a microtask queue (re-entrancy safe — a handler posting back
 * during dispatch cannot recurse synchronously).
 *
 * @returns the two transports (a ↔ b).
 */
export function createInProcessTransportPair(): {
  readonly a: BridgeTransport;
  readonly b: BridgeTransport;
} {
  const listeners: [
    ((message: BridgeMessage) => void) | null,
    ((message: BridgeMessage) => void) | null,
  ] = [null, null];
  const queues: [BridgeMessage[], BridgeMessage[]] = [[], []];
  const draining: [boolean, boolean] = [false, false];

  /** Drains side `index`'s queue into its listener. */
  const drainOf = (index: 0 | 1): (() => void) => {
    return () => {
      if (draining[index]) {
        return;
      }
      draining[index] = true;
      try {
        for (;;) {
          // No subscriber yet: messages WAIT (unlike postMessage, the
          // in-process channel defers until the first listener — the
          // handoff between handshake and RPC listeners depends on it).
          if (listeners[index] === null) {
            break;
          }
          const message = queues[index].shift();
          if (message === undefined) {
            break;
          }
          listeners[index]?.(message);
        }
      } finally {
        draining[index] = false;
      }
    };
  };
  const drains: [() => void, () => void] = [drainOf(0), drainOf(1)];

  const makeSide = (self: 0 | 1): BridgeTransport => {
    const other = (self === 0 ? 1 : 0) as 0 | 1;
    return {
      post(message: BridgeMessage): void {
        // The message lands in the RECEIVER's queue → schedule the
        // RECEIVER's drain.
        queues[other].push(message);
        queueMicrotask(drains[other]);
      },
      onMessage(listener: (message: BridgeMessage) => void): () => void {
        listeners[self] = listener;
        // Deferred drain: the subscriber (an RpcPeer) registers its
        // method handlers AFTER construction — a synchronous drain here
        // would serve queued requests against an empty handler table.
        queueMicrotask(drains[self]);
        return () => {
          if (listeners[self] === listener) {
            listeners[self] = null;
          }
        };
      },
    };
  };

  return { a: makeSide(0), b: makeSide(1) };
}
