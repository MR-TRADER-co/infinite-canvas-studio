/**
 * Plugin object layer (R9.9): the DOM overlay painting plugin-owned
 * canvas widgets.
 *
 * One INERT iframe per plugin object — `sandbox=""` (scripts disabled
 * entirely): the plugin's `renderWidget` snapshot HTML renders as pure
 * display content; the plugin is pinged ONCE per data revision and
 * NEVER while the catalog/panel scrolls (AC9.10). Hit-testing,
 * selection, dragging and undo stay in the host (the layer is
 * `pointer-events:none`).
 *
 * The layer rides the SAME rAF as the canvas (RenderCompanion,
 * CLAUDE.md §1.3): positions track `camera.worldToScreen` + zoom
 * exactly like the text layer, with offscreen culling. Objects whose
 * owning runtime is gone (plugin disabled) fall back to a dashed
 * placeholder card — the data itself is never touched.
 */

/** Injected layer dependencies. */
export interface PluginObjectLayerDeps {
  /** Resolves the runtime owning a wire type id (null = not running). */
  readonly runtimeForTypeId: (typeId: string) => {
    renderWidgetHtml(
      typeId: string,
      data: Record<string, unknown>,
      size: { width: number; height: number },
    ): Promise<string>;
  } | null;
}

/** One mounted widget view. */
interface WidgetView {
  readonly root: HTMLDivElement;
  readonly frame: HTMLIFrameElement;
  /** The data payload snapshot currently painted (identity compare). */
  paintedData: Record<string, unknown> | null;
  /** Whether a refresh is in flight (coalesce). */
  refreshing: boolean;
}

/** The world-space size of a plugin object view. */
interface ObjectSize {
  readonly width: number;
  readonly height: number;
}

/** Base classes of the layer root (below the text layer, z-[4]). */
const LAYER_CLASS =
  "plugin-object-layer pointer-events-none absolute inset-0 overflow-hidden z-[4]";

/**
 * The plugin object overlay layer (one instance per app).
 */
export class PluginObjectLayer {
  private root: HTMLDivElement | null = null;
  private readonly views = new Map<string, WidgetView>();

  /**
   * @param deps - injected dependencies.
   */
  public constructor(private readonly deps: PluginObjectLayerDeps) {}

  /**
   * Attaches the layer into its container (the canvas surface wrapper).
   *
   * @param container - the host element.
   */
  public attach(container: HTMLElement): void {
    if (this.root !== null) {
      return;
    }
    const root = document.createElement("div");
    root.className = LAYER_CLASS;
    root.setAttribute("aria-hidden", "true");
    container.appendChild(root);
    this.root = root;
  }

  /**
   * Detaches the layer (StrictMode-safe: remounts re-attach).
   */
  public detach(): void {
    if (this.root === null) {
      return;
    }
    for (const view of this.views.values()) {
      view.frame.remove();
      view.root.remove();
    }
    this.views.clear();
    this.root.remove();
    this.root = null;
  }

  /**
   * The per-frame sync (RenderCompanion): reconciles mounted views with
   * the scene's plugin objects, repositions everything under the
   * camera, and kicks widget refreshes for changed payloads.
   *
   * @param scene - the live scene.
   * @param camera - the current viewport camera.
   */
  public sync(
    scene: {
      readonly objects: readonly {
        readonly id: string;
        readonly kind: string;
        readonly visible: boolean;
        readonly position: { x: number; y: number };
        readonly rotation: number;
        readonly typeId?: string;
        readonly width?: number;
        readonly height?: number;
        readonly data?: Record<string, unknown>;
      }[];
    },
    camera: {
      worldToScreen(point: { x: number; y: number }): { x: number; y: number };
      readonly rotation: number;
      readonly zoom: number;
    },
  ): void {
    const root = this.root;
    if (root === null) {
      return;
    }
    const present = new Set<string>();
    for (const object of scene.objects) {
      if (object.kind !== "plugin" || object.typeId === undefined) {
        continue;
      }
      present.add(object.id);
      const size: ObjectSize = {
        width: typeof object.width === "number" ? object.width : 160,
        height: typeof object.height === "number" ? object.height : 120,
      };
      let view = this.views.get(object.id);
      if (view === undefined) {
        view = this.mountView(root, object.typeId);
        this.views.set(object.id, view);
      }
      // Position (the text layer's transform composition).
      const origin = camera.worldToScreen(object.position);
      view.root.style.transform =
        `translate(${origin.x}px, ${origin.y}px) ` +
        `rotate(${camera.rotation + object.rotation}rad) scale(${camera.zoom})`;
      view.root.style.width = `${size.width}px`;
      view.root.style.height = `${size.height}px`;
      view.root.style.display = object.visible ? "" : "none";
      // Payload refresh (identity compare — one ping per revision).
      const data = object.data ?? {};
      if (!view.refreshing && view.paintedData !== data && object.visible) {
        this.refreshWidget(view, object.typeId, data, size);
      }
    }
    // Unmount removed objects.
    for (const [id, view] of [...this.views.entries()]) {
      if (!present.has(id)) {
        view.frame.remove();
        view.root.remove();
        this.views.delete(id);
      }
    }
  }

  /**
   * Mounts one widget view (placeholder card until the first snapshot).
   *
   * @param root - the layer root.
   * @param typeId - the widget's wire type id.
   * @returns the view.
   */
  private mountView(root: HTMLDivElement, typeId: string): WidgetView {
    const viewRoot = document.createElement("div");
    viewRoot.className = "absolute top-0 left-0 origin-top-left";
    viewRoot.dataset.pluginTypeId = typeId;
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "");
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("aria-hidden", "true");
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.border = "0";
    frame.style.pointerEvents = "none";
    frame.title = `plugin-widget:${typeId}`;
    viewRoot.appendChild(frame);
    root.appendChild(viewRoot);
    return { root: viewRoot, frame, paintedData: null, refreshing: false };
  }

  /**
   * Fetches + applies one widget snapshot (coalesced).
   *
   * @param view - the view.
   * @param typeId - the wire type id.
   * @param data - the object's payload.
   * @param size - the widget size.
   */
  private refreshWidget(
    view: WidgetView,
    typeId: string,
    data: Record<string, unknown>,
    size: ObjectSize,
  ): void {
    const runtime = this.deps.runtimeForTypeId(typeId);
    view.refreshing = true;
    view.paintedData = data;
    if (runtime === null) {
      // Plugin gone: the dashed placeholder stays (data untouched).
      view.frame.srcdoc = "";
      view.refreshing = false;
      return;
    }
    runtime
      .renderWidgetHtml(typeId, data, size)
      .then((html) => {
        if (view.frame.isConnected && html.length > 0) {
          view.frame.srcdoc = html;
        }
      })
      .catch(() => {
        // Render failure: keep the last snapshot (never crash the app).
      })
      .finally(() => {
        view.refreshing = false;
      });
  }
}
