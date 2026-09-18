/**
 * Unit tests for the typed EventBus (CLAUDE.md §1.5: every core/ module gets
 * unit tests; target ≥80% coverage — this suite covers ≥90% of EventBus.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { EventBus, type AppEventMap } from "@/core/events/EventBus";

interface TestEventMap {
  ping: { value: number };
  pong: { note: string };
}

describe("EventBus", () => {
  it("delivers the emitted payload to a subscribed handler", () => {
    const bus = new EventBus<TestEventMap>();
    const handler = vi.fn<(payload: { value: number }) => void>();
    bus.on("ping", handler);

    bus.emit("ping", { value: 42 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ value: 42 });
  });

  it("notifies several handlers in subscription order", () => {
    const bus = new EventBus<TestEventMap>();
    const first = vi.fn();
    const second = vi.fn();
    bus.on("ping", first);
    bus.on("ping", second);

    bus.emit("ping", { value: 1 });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first.mock.invocationCallOrder[0] ?? -1).toBeLessThan(
      second.mock.invocationCallOrder[0] ?? -1,
    );
  });

  it("does not notify handlers of other events", () => {
    const bus = new EventBus<TestEventMap>();
    const handler = vi.fn();
    bus.on("ping", handler);

    bus.emit("pong", { note: "irrelevant" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribes via the function returned by on()", () => {
    const bus = new EventBus<TestEventMap>();
    const handler = vi.fn();
    const unsubscribe = bus.on("ping", handler);

    unsubscribe();
    bus.emit("ping", { value: 1 });

    expect(handler).not.toHaveBeenCalled();
  });

  it("off() removes only the given handler", () => {
    const bus = new EventBus<TestEventMap>();
    const kept = vi.fn();
    const removed = vi.fn();
    bus.on("ping", kept);
    bus.on("ping", removed);

    bus.off("ping", removed);
    bus.emit("ping", { value: 2 });

    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it("off() is a no-op for an unknown handler", () => {
    const bus = new EventBus<TestEventMap>();
    const handler = vi.fn();
    bus.on("ping", handler);

    expect(() => bus.off("ping", vi.fn())).not.toThrow();
    bus.emit("ping", { value: 3 });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("off() on an event without subscribers does not throw", () => {
    const bus = new EventBus<TestEventMap>();
    expect(() => bus.off("pong", vi.fn())).not.toThrow();
  });

  it("does not double-register the same handler reference", () => {
    const bus = new EventBus<TestEventMap>();
    const handler = vi.fn();
    bus.on("ping", handler);
    bus.on("ping", handler);

    bus.emit("ping", { value: 4 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount("ping")).toBe(1);
  });

  it("once() removes the handler after the first emit", () => {
    const bus = new EventBus<TestEventMap>();
    const handler = vi.fn();
    bus.once("ping", handler);

    bus.emit("ping", { value: 5 });
    bus.emit("ping", { value: 6 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ value: 5 });
    expect(bus.listenerCount("ping")).toBe(0);
  });

  it("once() can be cancelled before it fires", () => {
    const bus = new EventBus<TestEventMap>();
    const handler = vi.fn();
    const unsubscribe = bus.once("ping", handler);

    unsubscribe();
    bus.emit("ping", { value: 7 });

    expect(handler).not.toHaveBeenCalled();
  });

  it("emit() without subscribers is a no-op", () => {
    const bus = new EventBus<TestEventMap>();
    expect(() => bus.emit("ping", { value: 8 })).not.toThrow();
  });

  it("uses snapshot semantics: a handler removed during dispatch still runs once, then stops (Node.js-style)", () => {
    const bus = new EventBus<TestEventMap>();
    const second = vi.fn();
    const first = vi.fn<(payload: { value: number }) => void>(() => {
      bus.off("ping", second);
    });
    bus.on("ping", first);
    bus.on("ping", second);

    bus.emit("ping", { value: 9 });

    // The handler set is snapshotted before iteration, so `second` still
    // receives THIS emit even though `first` removed it mid-dispatch.
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    // Removal takes effect on subsequent emits.
    bus.emit("ping", { value: 10 });
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("listenerCount() tracks subscriptions across events", () => {
    const bus = new EventBus<TestEventMap>();
    expect(bus.listenerCount("ping")).toBe(0);

    const unsubscribeA = bus.on("ping", vi.fn());
    bus.on("ping", vi.fn());
    bus.on("pong", vi.fn());
    expect(bus.listenerCount("ping")).toBe(2);
    expect(bus.listenerCount("pong")).toBe(1);

    unsubscribeA();
    expect(bus.listenerCount("ping")).toBe(1);
  });

  it("clear() removes every handler of every event", () => {
    const bus = new EventBus<TestEventMap>();
    const pingHandler = vi.fn();
    const pongHandler = vi.fn();
    bus.on("ping", pingHandler);
    bus.on("pong", pongHandler);

    bus.clear();
    bus.emit("ping", { value: 10 });
    bus.emit("pong", { note: "gone" });

    expect(pingHandler).not.toHaveBeenCalled();
    expect(pongHandler).not.toHaveBeenCalled();
    expect(bus.listenerCount("ping")).toBe(0);
    expect(bus.listenerCount("pong")).toBe(0);
  });

  it("keeps bus instances independent", () => {
    const busA = new EventBus<TestEventMap>();
    const busB = new EventBus<TestEventMap>();
    const handlerA = vi.fn();
    busA.on("ping", handlerA);

    busB.emit("ping", { value: 11 });

    expect(handlerA).not.toHaveBeenCalled();
  });

  it("emits AppEventMap events end-to-end with typed payloads", () => {
    const bus = new EventBus<AppEventMap>();
    const started = vi.fn<(payload: { timestamp: number }) => void>();
    const toolChanged = vi.fn<(payload: { tool: string }) => void>();
    bus.on("app:started", started);
    bus.on("ui:tool-changed", toolChanged);

    bus.emit("app:started", { timestamp: 1234 });
    bus.emit("ui:tool-changed", { tool: "select" });

    expect(started).toHaveBeenCalledWith({ timestamp: 1234 });
    expect(toolChanged).toHaveBeenCalledWith({ tool: "select" });
  });
});
