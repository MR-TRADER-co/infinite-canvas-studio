/**
 * Text object view: a single text object's div, transformed to match the
 * camera (translate + rotate + scale) for pixel-perfect text at any zoom
 * (CLAUDE.md §1.3).
 *
 * Two content paths share this view:
 * - RICH (text boxes, Phase 3A): the object's TipTap JSON document is
 *   serialized to static HTML through the shared editor's schema — the same
 *   DOM the live ProseMirror view produces, so rendering is identical in
 *   both states (AC3A.1). While edited, the ONE shared editor host mounts
 *   inside this view (pointer events on, everything else stays none).
 * - LEGACY (sticky notes): plain `white-space: pre-wrap` text with the
 *   contentEditable edit session from earlier phases.
 *
 * Objects outside the viewport are culled (`display: none`); the edited
 * object never culls. Content measurement (`max-content` probing) resolves
 * the FIXED/AUTO growth geometry (R3A.7).
 */
import type { Camera } from "@/core/camera/Camera";
import { vec2 } from "@/core/geometry/Vec2";
import { isPinnedObject, pinAnchorToScreen } from "@/core/model/Pinned";
import {
  TEXT_COLOR_TOKEN,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING_X,
  TEXT_PADDING_Y,
} from "@/core/model/TextBoxObject";
import {
  STICKY_LINE_HEIGHT,
  STICKY_PADDING_X,
  STICKY_PADDING_Y,
} from "@/core/model/StickyNoteObject";
import type { TextBearingObject } from "@/text/commands/TextCommit";
import {
  getSharedTextEditor,
  renderRichTextHTML,
} from "@/text/editor/TipTapFactory";
import type { RichTextDocument } from "@/text/editor/richtext";
import type { TextEditorService } from "@/text/editor/TipTapFactory";

/** Screen-space culling bounds passed by the layer each sync. */
export interface ScreenViewport {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Visual variant of the view (fixed per object kind). */
export type TextObjectVariant = "plain" | "card";

/** DOM view of one text-bearing object. */
export class TextObjectView {
  /** The object's root div (created lazily on first mount). */
  private root: HTMLDivElement | null = null;

  /** Whether the view currently hosts the live editor. */
  private editing = false;

  /** Last rendered rich document (identity-keyed render cache). */
  private lastDoc: RichTextDocument | null = null;

  /** Whether a rich document has been rendered at least once. */
  private richRendered = false;

  /**
   * @param objectId - id of the scene object this view mirrors.
   * @param variant - visual variant (`plain` for text boxes, `card` for
   *        sticky notes); fixed for the object's lifetime.
   */
  public constructor(
    public readonly objectId: string,
    private readonly variant: TextObjectVariant = "plain",
  ) {}

  /**
   * Mounts the object's div into the text layer.
   *
   * @param parent - the text layer element to mount into.
   */
  public mount(parent: HTMLElement): void {
    if (this.root !== null) {
      return;
    }
    const root = document.createElement("div");
    root.className =
      this.variant === "card" ? `${VIEW_CLASS} sticky-note-view` : VIEW_CLASS;
    root.dir = "auto";
    root.lang = "fa";
    root.setAttribute("aria-multiline", "true");
    // E2E/a11y handle: the object id on the view root (deep-link tests).
    root.setAttribute("data-object-id", this.objectId);
    parent.appendChild(root);
    this.root = root;
  }

  /** Removes the object's div from the DOM. */
  public unmount(): void {
    this.root?.remove();
    this.root = null;
    this.editing = false;
    this.lastDoc = null;
    this.richRendered = false;
  }

  /**
   * @returns the view's root element (or null while unmounted).
   */
  public rootElement(): HTMLDivElement | null {
    return this.root;
  }

  /**
   * Applies geometry, content and culling for one frame. While the view
   * hosts the live editor, the DOM text is the user's — only geometry and
   * culling are touched.
   *
   * @param object - the current object data (text box or sticky note).
   * @param camera - the camera mapping world to screen space.
   * @param viewport - the screen-space culling bounds.
   */
  public update(
    object: TextBearingObject,
    camera: Camera,
    viewport: ScreenViewport,
  ): void {
    const root = this.root;
    if (root === null) {
      return;
    }
    // فاز ۲۵ «سنجاش روی صفحه»: a pinned view ignores the camera — the
    // anchor maps straight to screen pixels, the scale is 1 and only the
    // object's own rotation applies (upright screen furniture).
    // فاز ۳۰ «چرخش سنجاق‌شده»: the object's own rotation pivots around
    // its CENTRE (the canvas drawers'/hit-testing's convention — the
    // `origin-top-left` class keeps translate/scale anchored at the
    // top-left, so the rotation is expressed as an explicit centre-pivot
    // triplet instead of leaning on the transform origin).
    const pinned = isPinnedObject(object);
    const origin = pinned
      ? pinAnchorToScreen(
          object.pinAnchor ?? vec2(0, 0),
          {
            width: viewport.maxX - viewport.minX,
            height: viewport.maxY - viewport.minY,
          },
        )
      : camera.worldToScreen(object.position);
    root.style.transform = pinned
      ? `translate(${origin.x}px, ${origin.y}px) ` +
        `scale(1)` +
        centrePivotRotation(object.width, object.height, object.rotation)
      : // The camera transform anchors the element's top-left (its
        // position semantics); the object's own rotation then spins it
        // around its centre on top (a rotated object stays where it is —
        // `rotatedObjectBBox` and rotation-aware hit-testing agree).
        `translate(${origin.x}px, ${origin.y}px) ` +
        `rotate(${camera.rotation}rad) scale(${camera.zoom})` +
        centrePivotRotation(object.width, object.height, object.rotation);
    root.classList.toggle("text-object-pinned", pinned);
    root.style.width = `${object.width}px`;
    root.style.height = `${object.height}px`;
    root.style.fontSize = `${object.fontSize}px`;
    if (object.fontFamily !== undefined) {
      root.style.fontFamily = object.fontFamily;
    } else {
      root.style.fontFamily = "";
    }
    const isCard = object.kind === "stickyNote";
    // R13.3: named-style overrides win over the kind defaults.
    const weightOverride = (object as { fontWeight?: number }).fontWeight;
    if (weightOverride !== undefined) {
      root.style.fontWeight = String(weightOverride);
    } else {
      root.style.fontWeight = "";
    }
    const lineHeightOverride = (object as { lineHeight?: number })
      .lineHeight;
    root.style.lineHeight =
      lineHeightOverride !== undefined
        ? `${lineHeightOverride}`
        : isCard
          ? `${STICKY_LINE_HEIGHT}`
          : `${TEXT_LINE_HEIGHT}`;
    root.style.padding = isCard
      ? `${STICKY_PADDING_Y}px ${STICKY_PADDING_X}px`
      : `${TEXT_PADDING_Y}px ${TEXT_PADDING_X}px`;
    if (isCard) {
      root.style.backgroundColor = object.noteColor;
    } else {
      root.style.backgroundColor = "";
    }
    if (!this.editing) {
      this.applyStaticContent(object);
      root.style.color = object.color === TEXT_COLOR_TOKEN ? "" : object.color;
      root.classList.toggle(
        "text-foreground",
        object.color === TEXT_COLOR_TOKEN,
      );
    }
    this.applyCulling(object, camera, viewport);
  }

  /**
   * Renders the static (non-edited) content: the rich document HTML for
   * text boxes (identity-cached), plain text for sticky notes/legacy boxes.
   *
   * @param object - the current object data.
   */
  private applyStaticContent(object: TextBearingObject): void {
    const root = this.root;
    if (root === null) {
      return;
    }
    const doc = object.kind === "textBox" ? object.doc : null;
    if (doc !== null) {
      if (this.lastDoc !== doc) {
        const service = getSharedTextEditor();
        root.innerHTML = renderRichTextHTML(service.getSchema(), doc);
        this.lastDoc = doc;
        this.richRendered = true;
      }
      return;
    }
    // Legacy/plain path (sticky notes + pre-3A boxes).
    const text = root.textContent ?? "";
    if (this.richRendered || text !== object.text) {
      root.textContent = object.text;
      this.richRendered = false;
      this.lastDoc = null;
    }
  }

  /**
   * Marks the view's selection state (فاز ۲۵): pinned views draw their own
   * selection affordance (the canvas handles renderer owns only the world
   * pass), so the layer reports the selection membership per frame.
   *
   * @param selected - whether the object is in the live selection.
   */
  public setSelected(selected: boolean): void {
    this.root?.classList.toggle("text-object-pinned-selected", selected);
  }

  /**
   * Flips the view into RICH edit mode: the shared editor host mounts
   * inside this view (replacing the static content) with pointer events
   * enabled (R3A.1/R3A.2).
   *
   * @param service - the shared editor service.
   */
  public enterRichEdit(service: TextEditorService): void {
    const root = this.root;
    if (root === null || this.editing) {
      return;
    }
    this.editing = true;
    this.lastDoc = null;
    this.richRendered = false;
    root.classList.add("text-object-editing");
    root.classList.add("text-object-rich-editing");
    // Drop the static content FIRST (textContent would remove the host if
    // done after mounting), then let the shared editor host take its place.
    root.textContent = "";
    service.mount(root);
  }

  /**
   * Leaves RICH edit mode: the shared editor detaches and the static
   * content returns IMMEDIATELY (rendered synchronously from the final
   * document — an unchanged "none" commit triggers no scene event, so no
   * later frame would repaint the cleared DOM).
   *
   * @param doc - the object's final document (null = legacy/plain text).
   */
  public exitRichEdit(doc: RichTextDocument | null): void {
    const root = this.root;
    this.editing = false;
    if (root === null) {
      return;
    }
    root.classList.remove("text-object-editing");
    root.classList.remove("text-object-rich-editing");
    this.lastDoc = null;
    this.richRendered = false;
    root.textContent = "";
    if (doc !== null) {
      root.innerHTML = renderRichTextHTML(
        getSharedTextEditor().getSchema(),
        doc,
      );
      this.lastDoc = doc;
      this.richRendered = true;
    }
    root.blur();
  }

  /**
   * Flips the view into LEGACY edit mode (sticky notes): contenteditable
   * on, pointer events enabled, caret placed at the end of the current
   * text.
   *
   * Focus is applied at three deferred horizons (0ms, 120ms, 300ms): the
   * initiating click's default focus action (canvas clicks hand focus to
   * the body) completes AFTER the pointerup handler, and UI popovers close
   * on that same pointerdown and restore focus to their trigger on a later
   * frame — each steal lands between two horizons, so the guards re-focus
   * the editor and the session survives its own opening interactions.
   *
   * @param placeholder - the placeholder shown while the text is empty.
   */
  public enterEdit(placeholder: string): void {
    const root = this.root;
    if (root === null || this.editing) {
      return;
    }
    this.editing = true;
    root.contentEditable = "true";
    root.dataset.placeholder = placeholder;
    root.classList.add("text-object-editing");
    root.focus();
    this.placeCaretAtEnd(root);
    const refocus = (delay: number): void => {
      window.setTimeout(() => {
        if (this.editing && !root.contains(document.activeElement)) {
          root.focus();
          this.placeCaretAtEnd(root);
        }
      }, delay);
    };
    refocus(0);
    refocus(120);
    refocus(300);
  }

  /**
   * Leaves LEGACY edit mode: contenteditable off, DOM text restored from
   * the model (the next {@link TextObjectView.update} re-applies it anyway).
   *
   * @param text - the object's authoritative text.
   */
  public exitEdit(text: string): void {
    const root = this.root;
    this.editing = false;
    if (root === null) {
      return;
    }
    root.contentEditable = "false";
    delete root.dataset.placeholder;
    root.classList.remove("text-object-editing");
    root.textContent = text;
    root.blur();
  }

  /** @returns whether the view currently hosts the live editor. */
  public get isEditing(): boolean {
    return this.editing;
  }

  /**
   * @returns the live editor text (plain, paragraphs joined by `\n`), or
   *          null when the view is not editing (legacy sessions only —
   *          rich sessions read the shared editor service).
   */
  public editorText(): string | null {
    if (!this.editing || this.root === null) {
      return null;
    }
    return this.root.innerText;
  }

  /**
   * Updates the placeholder without disturbing the caret (legacy sessions).
   *
   * @param placeholder - the new placeholder string.
   */
  public setPlaceholder(placeholder: string): void {
    if (this.root !== null && this.editing) {
      this.root.dataset.placeholder = placeholder;
    }
  }

  /**
   * Measures the natural (longest-line) content width of the view,
   * including its padding — a transient `max-content` probe restored
   * immediately (layout is in the element's local, untransformed space).
   * The result is ceiled with a 1px safety margin: scrollWidth rounds
   * fractions DOWN, and a box 0.5px short of its longest line wraps it.
   *
   * @returns the natural width in world units, or 0 when unmounted.
   */
  public measureNaturalWidth(): number {
    const root = this.root;
    if (root === null) {
      return 0;
    }
    const previous = root.style.width;
    const previousHeight = root.style.height;
    root.style.width = "max-content";
    root.style.height = "auto";
    const natural = root.scrollWidth;
    root.style.width = previous;
    root.style.height = previousHeight;
    return Math.ceil(natural) + 1;
  }

  /**
   * Measures the content height when the view wraps at the given width
   * (including padding), ceiled with the same 1px safety margin.
   *
   * @param width - the wrap width in world units.
   * @returns the content height in world units, or 0 when unmounted.
   */
  public measureHeightAt(width: number): number {
    const root = this.root;
    if (root === null) {
      return 0;
    }
    const previous = root.style.width;
    const previousHeight = root.style.height;
    root.style.width = `${width}px`;
    root.style.height = "auto";
    const height = root.scrollHeight;
    root.style.width = previous;
    root.style.height = previousHeight;
    return Math.ceil(height) + 1;
  }

  /**
   * Moves the DOM caret to the end of the editable content.
   *
   * @param root - the editable element.
   */
  private placeCaretAtEnd(root: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const selection = window.getSelection();
    if (selection !== null) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  /**
   * Shows or hides the view based on the projected screen bounds.
   *
   * @param object - the object data providing the world rect.
   * @param camera - the camera mapping world to screen space.
   * @param viewport - the screen-space culling bounds.
   */
  private applyCulling(
    object: TextBearingObject,
    camera: Camera,
    viewport: ScreenViewport,
  ): void {
    const root = this.root;
    if (root === null) {
      return;
    }
    // Pinned views never cull (فاز ۲۵): they live IN the viewport by
    // construction — the anchor is always on screen.
    if (isPinnedObject(object)) {
      root.style.display = "";
      return;
    }
    const corner = camera.worldToScreen({
      x: object.position.x + object.width,
      y: object.position.y + object.height,
    });
    const origin = camera.worldToScreen(object.position);
    const minX = Math.min(origin.x, corner.x);
    const minY = Math.min(origin.y, corner.y);
    const maxX = Math.max(origin.x, corner.x);
    const maxY = Math.max(origin.y, corner.y);
    const outside =
      maxX < viewport.minX ||
      minX > viewport.maxX ||
      maxY < viewport.minY ||
      minY > viewport.maxY;
    // Culled objects stay in the DOM (display: none) so returning to the
    // viewport is instant — but the edited object never culls (its live
    // editor must stay interactable).
    if (this.editing) {
      root.style.display = "";
      return;
    }
    root.style.display = outside ? "none" : "";
  }
}

/** Base classes of every text object view (Tailwind-scanned literals). */
const VIEW_CLASS =
  "text-object-view pointer-events-none absolute top-0 left-0 box-border " +
  "whitespace-pre-wrap break-words font-sans font-normal " +
  "origin-top-left select-none subpixel-antialiased";

/**
 * Builds the centre-pivot rotation suffix of a text view's transform
 * (فاز ۳۰): `translate(centre) rotate(θ) translate(−centre)` — with the
 * element's `origin-top-left` class, translate/scale anchor the top-left
 * (the object's position semantics) while the object's own rotation
 * spins it around its CENTRE, exactly like the canvas drawers,
 * `rotatedObjectBBox` and rotation-aware hit-testing assume. Empty at
 * rest (rotation 0) so unrotated views keep the minimal transform.
 *
 * @param width - the object's width in local pixels.
 * @param height - the object's height in local pixels.
 * @param rotation - the object's rotation in radians.
 * @returns the transform suffix (possibly empty).
 */
function centrePivotRotation(
  width: number,
  height: number,
  rotation: number,
): string {
  if (rotation === 0) {
    return "";
  }
  const cx = width / 2;
  const cy = height / 2;
  return (
    ` translate(${cx}px, ${cy}px) rotate(${rotation}rad) ` +
    `translate(${-cx}px, ${-cy}px)`
  );
}
