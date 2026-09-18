/**
 * Context-menu contributions (R6.2): every context-menu item is a
 * REGISTERED CONTRIBUTION — leaf items reference registered commands
 * (labels/icons/disabled state resolve from the CommandRegistry), groups
 * are submenu builders. NOTHING here renders; the {@link ContextMenuHost}
 * renders whatever the registry merges for the current target.
 *
 * Target model:
 * - `region: "canvas"` (no `objectType`) — appears on every canvas
 *   right-click, empty or over an object;
 * - `region: "canvas", objectType: "*"` — appears only when an object is
 *   under the cursor (selection operations);
 * - `region: "canvas", objectType: "textBox"` — appears only for that
 *   kind (the edit-text entry);
 * - `region: "table"` / `region: "text"` — the editor surfaces.
 *
 * The ENTIRE table context menu is built on this system (R6.2): rows,
 * columns, merge, split (h + v), headers, direction, vertical alignment,
 * distribution, presets and delete — every action a registered command.
 */
import {
  ContextMenuRegistry,
  type ContextMenuContribution,
  type SubmenuBuilder,
} from "@/core/registry/ContextMenuRegistry";
import {
  CELL_VERTICAL_ALIGNMENTS,
  TABLE_STYLE_PRESETS,
} from "@/text/editor/extensions/table";

/** Convenience factory for one leaf command contribution. */
function command(
  id: string,
  target: ContextMenuContribution["target"],
  commandId: string,
  order: number,
): ContextMenuContribution {
  return { id, target, order, item: { kind: "command", commandId } };
}

/** Convenience factory for one separator contribution. */
function separator(
  id: string,
  target: ContextMenuContribution["target"],
  order: number,
): ContextMenuContribution {
  return { id, target, order, item: { kind: "separator" } };
}

/** Convenience factory for one submenu contribution. */
function submenu(
  id: string,
  target: ContextMenuContribution["target"],
  titleKey: string,
  order: number,
  build: SubmenuBuilder,
): ContextMenuContribution {
  return { id, target, order, item: { kind: "submenu", titleKey, build } };
}

/**
 * Registers the app's context-menu contributions (the table menu, the
 * canvas/object menu and the text menu) onto a registry.
 *
 * @param registry - the target registry (typically empty).
 * @returns the registry (chaining).
 */
export function registerContextMenuContributions(
  registry: ContextMenuRegistry,
): ContextMenuRegistry {
  registerTableMenu(registry);
  registerCanvasMenu(registry);
  registerTextMenu(registry);
  return registry;
}

/**
 * The TABLE region menu (R6.2): the entire table context menu as
 * contributions — insert row (above/below), insert column (left/right —
 * direction-aware), delete row/column/table, merge cells, split cell
 * (h + v), toggle header row/column, direction, vertical alignment,
 * uniform distribution and the style presets.
 *
 * @param registry - the target registry.
 */
function registerTableMenu(registry: ContextMenuRegistry): void {
  const target = { region: "table" } as const;
  registry.register(
    submenu("table.rows", target, "table.rows", 0, () => [
      { kind: "command", commandId: "core.table.insertRowAbove" },
      { kind: "command", commandId: "core.table.insertRowBelow" },
      { kind: "separator" },
      { kind: "command", commandId: "core.table.deleteRow" },
    ]),
  );
  registry.register(
    submenu("table.columns", target, "table.columns", 1, () => [
      { kind: "command", commandId: "core.table.insertColumnLeft" },
      { kind: "command", commandId: "core.table.insertColumnRight" },
      { kind: "separator" },
      { kind: "command", commandId: "core.table.deleteColumn" },
    ]),
  );
  registry.register(separator("table.sep1", target, 2));
  registry.register(command("table.merge", target, "core.table.mergeCells", 3));
  registry.register(
    submenu("table.split", target, "table.splitCell", 4, () => [
      { kind: "command", commandId: "core.table.splitCellHorizontal" },
      { kind: "command", commandId: "core.table.splitCellVertical" },
    ]),
  );
  registry.register(separator("table.sep2", target, 5));
  registry.register(
    command("table.headerRow", target, "core.table.toggleHeaderRow", 6),
  );
  registry.register(
    command("table.headerColumn", target, "core.table.toggleHeaderColumn", 7),
  );
  registry.register(
    command("table.direction", target, "core.table.toggleDirection", 8),
  );
  registry.register(separator("table.sep3", target, 9));
  registry.register(
    submenu("table.align", target, "table.verticalAlign", 10, () =>
      CELL_VERTICAL_ALIGNMENTS.map((align) => ({
        kind: "command" as const,
        commandId: `core.table.alignCell${
          align === "top" ? "Top" : align === "middle" ? "Middle" : "Bottom"
        }`,
      })),
    ),
  );
  registry.register(
    command("table.distribute", target, "core.table.distributeColumns", 11),
  );
  registry.register(
    submenu("table.preset", target, "table.preset", 12, () =>
      TABLE_STYLE_PRESETS.map((preset) => ({
        kind: "command" as const,
        commandId: `core.table.preset.${preset}`,
      })),
    ),
  );
  registry.register(separator("table.sep4", target, 13));
  registry.register(
    command("table.delete", target, "core.table.deleteTable", 14),
  );
}

/**
 * The CANVAS region menus: generic entries (empty canvas or over an
 * object — insert/select/view), object-scoped selection operations
 * (`objectType: "*"` — only when an object is hit) and the per-kind
 * edit-text entry.
 *
 * @param registry - the target registry.
 */
function registerCanvasMenu(registry: ContextMenuRegistry): void {
  const canvas = { region: "canvas" } as const;
  const object = { region: "canvas", objectType: "*" } as const;

  // Generic canvas entries (empty right-click and object right-click).
  registry.register(
    command("canvas.selectAll", canvas, "core.selection.selectAll", 0),
  );
  registry.register(separator("canvas.sep1", canvas, 1));
  registry.register(command("canvas.table", canvas, "core.table.insert", 2));
  registry.register(
    command("canvas.insertImage", canvas, "core.insert.image", 3),
  );
  registry.register(separator("canvas.sep2", canvas, 4));
  registry.register(command("canvas.fitAll", canvas, "core.view.fitAll", 5));
  registry.register(
    command("canvas.resetZoom", canvas, "core.view.resetZoom", 6),
  );
  registry.register(
    command("canvas.toggleGrid", canvas, "core.view.toggleGrid", 7),
  );

  // Selection operations — only when an object is under the cursor.
  // Phase 23 «پل کلیپ‌بورد»: copy/cut/paste open the cluster (the OS
  // bridge rides along — text into Word, PNG into Photoshop/AE).
  // فاز ۲۴: «کپی به‌صورت تصویر» rasterises ANY selection (multi-object
  // clusters included) into a transparent PNG on the system clipboard.
  registry.register(
    command("object.copy", object, "core.edit.copy", 0),
  );
  registry.register(command("object.cut", object, "core.edit.cut", 1));
  registry.register(
    command("object.copyAsImage", object, "core.edit.copyAsImage", 2),
  );
  registry.register(
    command("object.paste", canvas, "core.edit.paste", 8),
  );
  registry.register(
    command("object.duplicate", object, "core.selection.duplicate", 3),
  );
  registry.register(
    command("object.delete", object, "core.selection.delete", 4),
  );
  registry.register(separator("object.sep1", object, 5));
  registry.register(command("object.group", object, "core.selection.group", 6));
  registry.register(
    command("object.ungroup", object, "core.selection.ungroup", 7),
  );
  registry.register(
    command("object.lock", object, "core.selection.toggleLock", 8),
  );
  // فاز ۲۵ «سنجاش روی صفحه»: pin the selection to the viewport — it
  // stops following pans/zooms (Mod-Shift-P; the anchor keeps it put).
  registry.register(
    command("object.pin", object, "core.selection.togglePin", 9),
  );
  registry.register(separator("object.sep2", object, 10));
  registry.register(
    submenu("object.zOrder", object, "contextMenu.zOrder", 11, () => [
      { kind: "command", commandId: "core.selection.bringFront" },
      { kind: "command", commandId: "core.selection.bringForward" },
      { kind: "command", commandId: "core.selection.sendBackward" },
      { kind: "command", commandId: "core.selection.sendBack" },
    ]),
  );

  // Pack R11.6: the manual-link pair — «لینک به این شیء…» opens the
  // target picker; «حذف پیوندهای این شیء» (disabled unless the object
  // has outgoing manual links) removes them as ONE undo step.
  registry.register(separator("object.sep3", object, 12));
  registry.register(
    command("object.linkTo", object, "core.knowledge.linkTo", 13),
  );
  registry.register(
    command("object.unlinkAll", object, "core.knowledge.unlinkAll", 14),
  );

  // Phase 23: image-scoped entries — the OS-clipboard image copy (PNG at
  // the ORIGINAL intrinsic size) and the natural-size reset.
  registry.register(
    command("object.imageCopy", { region: "canvas", objectType: "image" }, "core.image.copy", 0),
  );
  registry.register(
    command(
      "object.imageReset",
      { region: "canvas", objectType: "image" },
      "core.image.resetSize",
      1,
    ),
  );

  // Per-kind entries: edit the text of text boxes and sticky notes.
  for (const kind of ["textBox", "stickyNote"] as const) {
    registry.register(
      command(
        `object.edit.${kind}`,
        { region: "canvas", objectType: kind },
        "core.text.editSelection",
        0,
      ),
    );
    // فاز ۳۶ «جدول به ورد»: text/table content → a real Word .docx file,
    // straight from the object's context menu (tables export as `w:tbl`).
    registry.register(
      command(
        `object.wordExport.${kind}`,
        { region: "canvas", objectType: kind },
        "core.export.word",
        1,
      ),
    );
  }
}

/**
 * The TEXT region menu (right-click in the editor outside tables):
 * character formatting + link + find.
 *
 * @param registry - the target registry.
 */
function registerTextMenu(registry: ContextMenuRegistry): void {
  const target = { region: "text" } as const;
  registry.register(command("text.bold", target, "core.text.bold", 0));
  registry.register(command("text.italic", target, "core.text.italic", 1));
  registry.register(
    command("text.underline", target, "core.text.underline", 2),
  );
  registry.register(command("text.strike", target, "core.text.strike", 3));
  registry.register(separator("text.sep1", target, 4));
  registry.register(command("text.link", target, "core.text.linkDialog", 5));
  registry.register(separator("text.sep2", target, 6));
  registry.register(command("text.find", target, "core.find.open", 7));
}
