/**
 * Catalog insertion (R7.12): creates an object from an Insert-Panel card
 * at a world point — the shared engine behind BOTH panel interactions
 * (click → viewport centre, pointer-drag drop → release point).
 *
 * The card's registry factory produces the default instance; the instance
 * is translated so its bounding-box CENTRE lands exactly on the target
 * point (kind-aware translation — freehand points and connector endpoint
 * caches ride along), then committed through ONE `AddObjectCommand`
 * (exactly one undo step, AC7.14/AC7.15). Pure resolution logic — no
 * React/DOM imports, node-testable.
 */
import type { Scene } from "@/core/model/Scene";
import type { SceneObjectData } from "@/core/model/SceneObject";
import { objectBBox, translateSceneObject } from "@/core/model/SceneObject";
import type { Vec2 } from "@/core/geometry/Vec2";
import { AddObjectCommand } from "@/core/commands/AddObjectCommand";
import type { HistoryManager } from "@/core/history/HistoryManager";
import type {
  ObjectCatalogCard,
  ObjectRegistry,
  ObjectRegistryEntry,
} from "@/core/registry/ObjectRegistry";

/** The flattened view of one insertable card the panel renders. */
export interface CatalogCardView {
  /** Registry id of the owning type (`core.shape`). */
  readonly typeId: string;
  /** In-memory kind of the owning type (diagnostics). */
  readonly kind: string;
  /** Variant key (`rectangle` / `ellipse` / the type's own id). */
  readonly key: string;
  /** Catalog group (`shapes` / `text&notes` / `media` / `drawing`). */
  readonly group: string;
  /** Icon name (lucide). */
  readonly icon?: string;
  /** i18n key of the card title. */
  readonly titleKey: string;
  /** Order inside the group (ascending). */
  readonly order: number;
  /** Optional preview hint (emoji or CSS gradient, §1.7.7). */
  readonly preview?: string;
  /** The plugin owner when the card is plugin-owned (async insert, R9.9). */
  readonly pluginOwner?: string;
  /** The card's factory (default instance). */
  readonly factory: () => SceneObjectData;
}

/**
 * Resolves every insertable card of a registry: entries WITH catalog
 * metadata contribute their card variants (or the single default card).
 * Sorts by group then order — the Insert Panel renders groups in this
 * order with headers (AC7.13: a dummy registration appears with ZERO
 * panel-code edits because the panel only consumes this list).
 *
 * @param registry - the object registry.
 * @returns the card views, group-ordered.
 */
export function resolveCatalogCards(
  registry: ObjectRegistry,
): readonly CatalogCardView[] {
  const cards: CatalogCardView[] = [];
  for (const entry of registry.list()) {
    const catalog = entry.catalog;
    if (catalog === undefined) {
      continue;
    }
    const variants: readonly ObjectCatalogCard[] = catalog.cards ?? [
      {
        key: entry.id,
        icon: catalog.icon,
        titleKey: catalog.titleKey,
        order: catalog.order,
        preview: catalog.preview,
        factory: () => entry.factory(),
      },
    ];
    for (const variant of variants) {
      cards.push({
        typeId: entry.id,
        kind: entry.kind,
        key: variant.key,
        group: catalog.group,
        icon: variant.icon,
        titleKey: variant.titleKey,
        order: variant.order,
        preview: variant.preview,
        pluginOwner: ownerOfEntry(entry.id),
        factory: variant.factory,
      });
    }
  }
  cards.sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order);
  return cards;
}

/**
 * @param typeId - the registry entry id.
 * @returns the owner prefix when it is NOT core (plugin-owned), else
 *          undefined.
 */
function ownerOfEntry(typeId: string): string | undefined {
  const owner = typeId.split(".")[0] ?? "";
  return owner === "core" ? undefined : owner;
}

/**
 * Inserts a card's object with its bbox centre at the target world point
 * (one undo step, default size per type — AC7.14/AC7.15).
 *
 * @param scene - the scene receiving the object.
 * @param history - the history stack (one AddObjectCommand).
 * @param registry - the object registry resolving the card.
 * @param typeId - the card's owning type id.
 * @param cardKey - the card's variant key (the type id when default).
 * @param centre - the world point the object centres on.
 * @returns the created object, or null when the type/card is unknown.
 */
export function insertCatalogObject(
  scene: Scene,
  history: HistoryManager,
  registry: ObjectRegistry,
  typeId: string,
  cardKey: string,
  centre: Vec2,
): SceneObjectData | null {
  const entry = registry.entryForTypeId(typeId);
  if (entry === undefined) {
    return null;
  }
  const card = cardOf(entry, cardKey);
  if (card === null) {
    return null;
  }
  const draft = card.factory();
  const box = objectBBox(draft);
  const offsetX = centre.x - (box.minX + box.maxX) / 2;
  const offsetY = centre.y - (box.minY + box.maxY) / 2;
  const object =
    offsetX === 0 && offsetY === 0
      ? draft
      : translateSceneObject(draft, { x: offsetX, y: offsetY });
  const command = new AddObjectCommand(scene, object);
  command.do();
  history.push(command);
  return object;
}

/**
 * Resolves one card of an entry (variant by key, or the default card).
 *
 * @param entry - the registry entry.
 * @param cardKey - the variant key (the entry id when default).
 * @returns the card, or null when the key is unknown.
 */
function cardOf(
  entry: ObjectRegistryEntry,
  cardKey: string,
): ObjectCatalogCard | null {
  const catalog = entry.catalog;
  if (catalog === undefined) {
    return null;
  }
  if (catalog.cards !== undefined) {
    const variant = catalog.cards.find((card) => card.key === cardKey);
    return variant ?? null;
  }
  if (cardKey === entry.id) {
    return {
      key: entry.id,
      icon: catalog.icon,
      titleKey: catalog.titleKey,
      order: catalog.order,
      factory: () => entry.factory(),
    };
  }
  return null;
}
