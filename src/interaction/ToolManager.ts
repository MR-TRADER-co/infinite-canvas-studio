/**
 * Tool manager: registry + activator for canvas tools (strategy pattern).
 *
 * Exactly one tool is active at a time; activating a new tool deactivates
 * the previous one so tools can flush their state.
 *
 * PHASE 0 STUB — fully implemented in a later phase.
 */
import type { ITool } from "@/interaction/Tool";

/** Owns every registered tool and the currently active one. */
export class ToolManager {
  private readonly tools = new Map<string, ITool>();
  private active: ITool | null = null;

  /**
   * Registers a tool (idempotent: re-registration replaces the tool).
   *
   * @param tool - the tool to register.
   */
  public register(tool: ITool): void {
    this.tools.set(tool.id, tool);
  }

  /**
   * Activates the tool registered under `id`.
   *
   * @param id - id of the tool to activate.
   * @returns whether a tool with that id existed and was activated.
   */
  public activate(id: string): boolean {
    const tool = this.tools.get(id);
    if (tool === undefined) {
      return false;
    }
    this.deactivate();
    this.active = tool;
    tool.onActivate();
    return true;
  }

  /** Deactivates the active tool, if any. */
  public deactivate(): void {
    if (this.active !== null) {
      this.active.onDeactivate();
      this.active = null;
    }
  }

  /** @returns the active tool, or null when none is active. */
  public get activeTool(): ITool | null {
    return this.active;
  }
}
