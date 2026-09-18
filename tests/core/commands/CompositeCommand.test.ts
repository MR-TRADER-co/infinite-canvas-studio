/** Unit tests for the composite (bundled) command. */
import { describe, expect, it } from "vitest";
import { CompositeCommand } from "@/core/commands/CompositeCommand";
import { HistoryManager } from "@/core/history/HistoryManager";
import type { ICommand } from "@/core/commands/Command";

/** Command double appending its tag to a shared call log. */
class LoggingCommand implements ICommand {
  public readonly label: string;
  private readonly tag: string;
  private readonly log: string[];

  public constructor(tag: string, log: string[]) {
    this.tag = tag;
    this.log = log;
    this.label = `command.${tag}`;
  }

  public do(): void {
    this.log.push(`do:${this.tag}`);
  }

  public undo(): void {
    this.log.push(`undo:${this.tag}`);
  }

  public redo(): void {
    this.log.push(`redo:${this.tag}`);
  }
}

describe("CompositeCommand", () => {
  it("exposes its label and child commands", () => {
    const log: string[] = [];
    const children = [
      new LoggingCommand("a", log),
      new LoggingCommand("b", log),
    ];
    const composite = new CompositeCommand("command.bundle", children);
    expect(composite.label).toBe("command.bundle");
    expect(composite.commands).toBe(children);
  });

  it("do applies the children in order", () => {
    const log: string[] = [];
    const composite = new CompositeCommand("command.bundle", [
      new LoggingCommand("a", log),
      new LoggingCommand("b", log),
      new LoggingCommand("c", log),
    ]);
    composite.do();
    expect(log).toEqual(["do:a", "do:b", "do:c"]);
  });

  it("undo reverts the children in reverse order", () => {
    const log: string[] = [];
    const composite = new CompositeCommand("command.bundle", [
      new LoggingCommand("a", log),
      new LoggingCommand("b", log),
      new LoggingCommand("c", log),
    ]);
    composite.do();
    composite.undo();
    expect(log).toEqual(["do:a", "do:b", "do:c", "undo:c", "undo:b", "undo:a"]);
  });

  it("redo re-applies the children in order", () => {
    const log: string[] = [];
    const composite = new CompositeCommand("command.bundle", [
      new LoggingCommand("a", log),
      new LoggingCommand("b", log),
      new LoggingCommand("c", log),
    ]);
    composite.do();
    composite.undo();
    composite.redo();
    expect(log).toEqual([
      "do:a",
      "do:b",
      "do:c",
      "undo:c",
      "undo:b",
      "undo:a",
      "redo:a",
      "redo:b",
      "redo:c",
    ]);
  });

  it("handles the empty composite gracefully", () => {
    const composite = new CompositeCommand("command.empty", []);
    expect(() => {
      composite.do();
      composite.undo();
      composite.redo();
    }).not.toThrow();
  });

  it("undo tolerates holes in the children array (defensive guard, white-box)", () => {
    const log: string[] = [];
    const a = new LoggingCommand("a", log);
    const c = new LoggingCommand("c", log);
    // Growing the array beyond its elements leaves a hole at the end; undo()
    // indexes the list (noUncheckedIndexedAccess guard) and must skip it.
    const children: ICommand[] = [a, c];
    children.length = 3;
    const composite = new CompositeCommand("command.sparse", children);
    composite.undo();
    expect(log).toEqual(["undo:c", "undo:a"]);
  });

  it("works as a single history entry end-to-end", () => {
    const log: string[] = [];
    const composite = new CompositeCommand("command.bundle", [
      new LoggingCommand("a", log),
      new LoggingCommand("b", log),
    ]);
    const history = new HistoryManager();
    composite.do();
    history.push(composite);
    history.undo();
    expect(log).toEqual(["do:a", "do:b", "undo:b", "undo:a"]);
    history.redo();
    expect(log).toEqual([
      "do:a",
      "do:b",
      "undo:b",
      "undo:a",
      "redo:a",
      "redo:b",
    ]);
  });
});
