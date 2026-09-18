/**
 * The in-canvas selection clipboard (Phase 23 — «پل کلیپ‌بورد»).
 *
 * Pure core, no DOM: `copy` snapshots the expanded selection (groups ride
 * with their members) as deep clones plus the payload's bounding-box
 * anchor; `paste` re-materialises the payload with FRESH ids at the
 * current viewport centre with a small cascade (one composite undo step);
 * `cut` composes copy + removal.
 *
 * The OS-clipboard side effects (writing text/`image/png` so Word,
 * Photoshop or After Effects can receive the copy) live in the ui layer
 * (`ui/clipboard/osClipboard.ts`) — this module stays node-testable.
 */
import type { HistoryManager } from "@/core/history/HistoryManager";
import type { IdGenerator } from "@/core/id/IdGenerator";
import type { Selection } from "@/core/selection/Selection";
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { expandGroupMemberIds } from "@/core/model/GroupObject";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import { RemoveObjectCommand } from "@/core/commands/RemoveObjectCommand";
import { CompositeCommand } from "@/core/commands/CompositeCommand";
import { duplicateObjectDeep } from "@/core/commands/SelectionOps";
import { bbox, bboxCenter, bboxUnion, type BBox } from "@/core/geometry/BBox";
import { vec2, type Vec2 } from "@/core/geometry/Vec2";

/** Cascade step between successive pastes (world units). */
export const PASTE_CASCADE_STEP = 24;

/** Pastes within this window keep cascading (ms). */
const PASTE_CASCADE_WINDOW_MS = 8000;

/** A cut/copy payload: the expanded object clones + the selection anchor. */
export interface SelectionClipboardPayload {
  /** Deep clones, parents before members (the `expanded` id order). */
  readonly objects: readonly SceneObjectData[];
  /** The TOP-LEVEL ids of the copied selection (paste selection basis). */
  readonly topLevelIds: readonly string[];
  /** Payload bounding box in ORIGINAL world coordinates. */
  readonly anchor: BBox;
  /** Epoch millis — drives the paste cascade window. */
  readonly copiedAt: number;
}

/** Computes the coarse bounds of one object (position + size). */
function objectBBox(object: SceneObjectData): BBox {
  const width = "width" in object ? Number(object.width ?? 0) : 0;
  const height = "height" in object ? Number(object.height ?? 0) : 0;
  return bbox(
    object.position.x,
    object.position.y,
    object.position.x + width,
    object.position.y + height,
  );
}

/** Computes the combined bounds of a payload/object list. */
export function objectsBBox(objects: readonly SceneObjectData[]): BBox {
  let box: BBox | null = null;
  for (const object of objects) {
    const next = objectBBox(object);
    box = box === null ? next : bboxUnion(box, next);
  }
  return box ?? bbox(0, 0, 0, 0);
}

/**
 * Snapshots the current selection as a copy payload.
 *
 * @param scene - the scene the objects live in.
 * @param selection - the selection being copied.
 * @returns the payload, or null for an empty selection.
 */
export function copySelectionPayload(
  scene: Scene,
  selection: Selection,
): SelectionClipboardPayload | null {
  const topLevelIds = [...selection.ids];
  if (topLevelIds.length === 0) {
    return null;
  }
  const expanded = expandGroupMemberIds(scene, topLevelIds);
  const objects: SceneObjectData[] = [];
  for (const id of expanded) {
    const object = scene.findById(id);
    if (object !== undefined) {
      objects.push(object);
    }
  }
  if (objects.length === 0) {
    return null;
  }
  const clones = objects.map(
    (object) => JSON.parse(JSON.stringify(object)) as SceneObjectData,
  );
  return {
    objects: clones,
    topLevelIds,
    anchor: objectsBBox(clones),
    copiedAt: Date.now(),
  };
}

/**
 * The plain-text projection of a selection for the SYSTEM clipboard
 * (Phase 23: copying a note outward pastes its text into Word & friends).
 * Text boxes and sticky notes contribute their text; other kinds are
 * skipped; multiple text objects join with a blank line.
 *
 * @param objects - the objects being copied outward.
 * @returns the joined text, or null when nothing textual is selected.
 */
export function plainTextOfObjects(
  objects: readonly SceneObjectData[],
): string | null {
  const texts: string[] = [];
  for (const object of objects) {
    if (object.kind === "textBox" || object.kind === "stickyNote") {
      const text = String(
        "text" in object ? (object.text as string | undefined) : undefined,
      ).trim();
      if (text !== "") {
        texts.push(text);
      }
    }
  }
  if (texts.length === 0) {
    return null;
  }
  return texts.join("\n\n");
}

/** Paste bookkeeping (module-global: one paste stream per app). */
let pasteCascadeIndex = 0;
let lastPasteAt = 0;

/**
 * The paste placement for one payload against a target centre.
 *
 * @param payload - the clipboard payload being pasted.
 * @param centre - the current viewport centre (world space).
 * @returns the world-space translation for the pasted copies.
 */
export function pasteTranslation(
  payload: SelectionClipboardPayload,
  centre: Vec2,
): Vec2 {
  const now = Date.now();
  if (now - lastPasteAt > PASTE_CASCADE_WINDOW_MS) {
    pasteCascadeIndex = 0;
  }
  lastPasteAt = now;
  const cascade = (pasteCascadeIndex % 8) * PASTE_CASCADE_STEP;
  pasteCascadeIndex += 1;
  const anchorCentre = bboxCenter(payload.anchor);
  return vec2(
    centre.x - anchorCentre.x + cascade,
    centre.y - anchorCentre.y + cascade,
  );
}

/**
 * The application-wide selection clipboard. A module singleton keeps the
 * buffer alive across panel remounts (the recent-stickers store
 * precedent); scenes are injected per operation, so the state is pure.
 */
export class SelectionClipboard {
  private payload: SelectionClipboardPayload | null = null;

  /** @returns whether a paste would produce objects. */
  public hasContent(): boolean {
    return this.payload !== null;
  }

  /** @returns the number of objects a paste would produce. */
  public objectCount(): number {
    return this.payload?.objects.length ?? 0;
  }

  /**
   * Snapshots the selection (copy). OS side effects are the caller's.
   *
   * @param scene - the scene being copied from.
   * @param selection - the selection being copied.
   * @returns the copied object count, or 0 for an empty selection.
   */
  public copy(scene: Scene, selection: Selection): number {
    const payload = copySelectionPayload(scene, selection);
    if (payload === null) {
      return 0;
    }
    this.payload = payload;
    return payload.objects.length;
  }

  /**
   * Copies then removes the selection (cut): ONE composite undo step for
   * the removal, the clipboard side is side-effect-free.
   *
   * @param scene - the scene being cut from.
   * @param history - history recording the removal.
   * @param selection - the selection being cut.
   * @returns the cut object count, or 0 for an empty selection.
   */
  public cut(
    scene: Scene,
    history: HistoryManager,
    selection: Selection,
  ): number {
    const payload = copySelectionPayload(scene, selection);
    if (payload === null) {
      return 0;
    }
    this.payload = payload;
    const commands: RemoveObjectCommand[] = [];
    for (const object of payload.objects) {
      const live = scene.findById(object.id);
      if (live === undefined) {
        continue;
      }
      const command = new RemoveObjectCommand(scene, live);
      command.do();
      commands.push(command);
    }
    if (commands.length > 0) {
      history.push(
        commands.length === 1
          ? (commands[0] as RemoveObjectCommand)
          : new CompositeCommand("command.cutSelection", commands),
      );
    }
    selection.clear();
    return payload.objects.length;
  }

  /**
   * Materialises the clipboard payload with fresh ids at the viewport
   * centre (cascade-offset for bursts): ONE composite undo step.
   *
   * @param scene - the scene pasting into.
   * @param history - history recording the paste.
   * @param selection - the selection replaced by the pasted top-levels.
   * @param ids - id allocator for the copies.
   * @param centre - the current viewport centre (world space).
   * @returns the pasted top-level ids, or null when the clipboard is empty.
   */
  public paste(
    scene: Scene,
    history: HistoryManager,
    selection: Selection,
    ids: IdGenerator,
    centre: Vec2,
  ): string[] | null {
    const payload = this.payload;
    if (payload === null) {
      return null;
    }
    const offset = pasteTranslation(payload, centre);
    const idMap = new Map<string, string>();
    for (const object of payload.objects) {
      idMap.set(object.id, ids.next());
    }
    const commands: AddObjectCommand[] = [];
    let z = scene.nextZIndex();
    for (const object of payload.objects) {
      const copy = duplicateObjectDeep(object, idMap, offset, z);
      z += 1;
      const command = new AddObjectCommand(scene, copy);
      command.do();
      commands.push(command);
    }
    if (commands.length === 0) {
      return null;
    }
    history.push(new CompositeCommand("command.pasteSelection", commands));
    const pastedTopLevel = payload.topLevelIds
      .map((id) => idMap.get(id))
      .filter((copy): copy is string => copy !== undefined);
    selection.replaceAll(pastedTopLevel);
    return pastedTopLevel;
  }

  /** Clears the buffer (used by tests and full resets). */
  public clear(): void {
    this.payload = null;
    pasteCascadeIndex = 0;
    lastPasteAt = 0;
  }
}

/** The app-global selection clipboard singleton. */
export const appSelectionClipboard = new SelectionClipboard();
