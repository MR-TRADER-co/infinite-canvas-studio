/** Unit tests for the bounded undo/redo history manager. */
import { describe, expect, it, vi } from "vitest";
import { HistoryManager } from "@/core/history/HistoryManager";
import type { ICommand } from "@/core/commands/Command";

/** Minimal command double counting its do/undo/redo invocations. */
class CountingCommand implements ICommand {
  public readonly label: string;
  public doCalls = 0;
  public undoCalls = 0;
  public redoCalls = 0;

  public constructor(label = "counting") {
    this.label = label;
  }

  public do(): void {
    this.doCalls += 1;
  }

  public undo(): void {
    this.undoCalls += 1;
  }

  public redo(): void {
    this.redoCalls += 1;
  }
}

describe("HistoryManager", () => {
  it("defaults the limit to 200 (interaction spec R2.6)", () => {
    expect(new HistoryManager().limit).toBe(200);
  });

  it("starts empty: nothing to undo or redo", () => {
    const history = new HistoryManager();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });

  it("push records an executed command without re-executing it", () => {
    const command = new CountingCommand();
    const history = new HistoryManager();
    history.push(command);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
    expect(command.doCalls).toBe(0);
  });

  it("undo reverts the most recent command and moves it to the redo stack", () => {
    const command = new CountingCommand();
    const history = new HistoryManager();
    history.push(command);
    expect(history.undo()).toBe(command);
    expect(command.undoCalls).toBe(1);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });

  it("redo re-applies the undone command and returns it", () => {
    const command = new CountingCommand();
    const history = new HistoryManager();
    history.push(command);
    history.undo();
    expect(history.redo()).toBe(command);
    expect(command.redoCalls).toBe(1);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it("undo/redo are LIFO across several commands", () => {
    const a = new CountingCommand("a");
    const b = new CountingCommand("b");
    const history = new HistoryManager();
    history.push(a);
    history.push(b);
    expect(history.undo()).toBe(b);
    expect(history.undo()).toBe(a);
    expect(history.redo()).toBe(a);
    expect(history.redo()).toBe(b);
    expect(a.undoCalls).toBe(1);
    expect(b.undoCalls).toBe(1);
    expect(a.redoCalls).toBe(1);
    expect(b.redoCalls).toBe(1);
  });

  it("push clears the redo branch", () => {
    const a = new CountingCommand("a");
    const b = new CountingCommand("b");
    const history = new HistoryManager();
    history.push(a);
    history.undo();
    history.push(b);
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBeNull();
    expect(a.undoCalls).toBe(1);
    expect(a.redoCalls).toBe(0);
  });

  it("evicts the oldest command beyond the limit", () => {
    const a = new CountingCommand("a");
    const b = new CountingCommand("b");
    const c = new CountingCommand("c");
    const history = new HistoryManager(2);
    history.push(a);
    history.push(b);
    history.push(c);
    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toBe(c);
    expect(history.undo()).toBe(b);
    expect(history.undo()).toBeNull();
    expect(history.canUndo()).toBe(false);
    expect(a.undoCalls).toBe(0);
  });

  it("clear forgets the entire history", () => {
    const history = new HistoryManager();
    history.push(new CountingCommand("a"));
    history.undo();
    history.push(new CountingCommand("b"));
    history.clear();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });

  it("notifies on push, undo, redo and clear", () => {
    const onChange = vi.fn();
    const history = new HistoryManager(10, onChange);
    history.push(new CountingCommand("a"));
    history.undo();
    history.redo();
    history.clear();
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("does not notify when undo/redo find nothing to do", () => {
    const onChange = vi.fn();
    const history = new HistoryManager(10, onChange);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("operates safely without a notifier", () => {
    const history = new HistoryManager(2);
    expect(() => {
      history.push(new CountingCommand("a"));
      history.undo();
      history.redo();
      history.clear();
    }).not.toThrow();
  });
});
