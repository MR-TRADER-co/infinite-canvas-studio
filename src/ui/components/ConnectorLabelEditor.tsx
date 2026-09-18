"use client";

/**
 * Connector label editor (R5.3): a bare single-line `<input>` riding the
 * connector's path MIDPOINT (NOT TipTap — the spec keeps labels plain).
 *
 * Double-clicking a connector (`ui:connector-label-requested` on the bus,
 * emitted by the select tool) opens the editor pre-filled with the current
 * caption; Enter or blur commits through an `UpdateObjectCommand` (one
 * undo step — clearing the text removes the label), Escape cancels
 * untouched. The chip re-projects every frame while editing (the same
 * rAF-coalesced camera/scene pass as the name badges) so it keeps riding
 * the midpoint through pans, zooms and endpoint re-glues.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { AppContext } from "@/AppContext";
import { Application, Services } from "@/App";
import {
  connectorLabelAnchor,
  isConnectorObject,
  type ConnectorObjectData,
} from "@/core/model/ConnectorObject";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import { useTranslation } from "@/ui/i18n";

/** Longest caption the editor accepts (single-line chip stays small). */
const LABEL_MAX_LENGTH = 80;

/** One committed placement pass (screen space, CSS pixels). */
interface EditorPlacement {
  /** Screen x of the path midpoint. */
  readonly x: number;
  /** Screen y of the path midpoint. */
  readonly y: number;
}

/** The connector label editor (bus-driven visibility). */
export default function ConnectorLabelEditor(): ReactElement | null {
  const { t, language } = useTranslation();
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [placement, setPlacement] = useState<EditorPlacement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(true);

  /** Commits the caption (or clears it) as one undoable patch. */
  const commit = (caption: string): void => {
    const id = connectorId;
    if (id === null) {
      return;
    }
    const trimmed = caption.trim().slice(0, LABEL_MAX_LENGTH);
    const scene = AppContext.getDefault().tryGet(Services.scene);
    const history = AppContext.getDefault().tryGet(Services.history);
    const raw = scene?.findById(id);
    if (scene === undefined || history === undefined || raw === undefined) {
      return;
    }
    if (!isConnectorObject(raw)) {
      return;
    }
    const object: ConnectorObjectData = raw;
    if ((object.label ?? "") === trimmed) {
      return;
    }
    // An empty caption clears the label: the renderer and the serializer
    // both treat "" as absent, so the field round-trips label-less.
    const command = new UpdateObjectCommand(
      scene,
      id,
      { label: trimmed },
      object,
    );
    command.do();
    history.push(command);
  };

  /** Closes the editor (with or without committing). */
  const close = (apply: boolean): void => {
    if (apply && !committedRef.current) {
      commit(value);
      committedRef.current = true;
    }
    setConnectorId(null);
    setPlacement(null);
  };

  // Bus-driven lifecycle: the select tool's double-click opens the editor;
  // camera/scene events keep the chip riding the (live-resolved) midpoint.
  useEffect(() => {
    let frameId: number | null = null;
    const disposers: Array<() => void> = [];
    let cancelled = false;
    let openId: string | null = null;

    const run = (): void => {
      frameId = null;
      const id = openId ?? connectorId;
      if (id === null) {
        return;
      }
      const scene = AppContext.getDefault().tryGet(Services.scene);
      const container = document.querySelector<HTMLElement>("main");
      if (scene === undefined || container === null) {
        return;
      }
      const connector = scene.findById(id);
      if (connector === undefined || !isConnectorObject(connector)) {
        setConnectorId(null);
        setPlacement(null);
        return;
      }
      const anchor = connectorLabelAnchor(connector, scene.objects);
      if (anchor === null) {
        setPlacement(null);
        return;
      }
      const screen = scene.camera.worldToScreen(anchor);
      const rect = container.getBoundingClientRect();
      setPlacement({ x: screen.x + rect.left, y: screen.y + rect.top });
    };

    const schedule = (): void => {
      if (frameId === null) {
        frameId = requestAnimationFrame(run);
      }
    };

    void Application.boot().then((context: AppContext) => {
      if (cancelled) {
        return;
      }
      const bus = context.get(Services.eventBus);
      const scene = context.get(Services.scene);
      disposers.push(
        bus.on("ui:connector-label-requested", ({ objectId }) => {
          const connector = scene.findById(objectId);
          if (
            connector !== undefined &&
            isConnectorObject(connector) &&
            !connector.locked
          ) {
            openId = objectId;
            committedRef.current = false;
            setValue(connector.label ?? "");
            setConnectorId(objectId);
            schedule();
            requestAnimationFrame(() => {
              inputRef.current?.focus();
              inputRef.current?.select();
            });
          }
        }),
        bus.on("camera:changed", schedule),
        bus.on("scene:changed", schedule),
      );
      schedule();
    });

    return () => {
      cancelled = true;
      openId = null;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      for (const dispose of disposers) {
        dispose();
      }
    };
    // The editor lifetime is app-scoped; open/close flows through state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (connectorId === null || placement === null) {
    return null;
  }

  return (
    <div
      className="fixed z-40 -translate-x-1/2 -translate-y-1/2"
      style={{ left: placement.x, top: placement.y }}
      dir={language === "fa" ? "rtl" : "ltr"}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        maxLength={LABEL_MAX_LENGTH}
        placeholder={t("connector.labelPlaceholder")}
        aria-label={t("connector.label")}
        title={t("connector.labelHint")}
        onChange={(event) => {
          committedRef.current = false;
          setValue(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            close(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            committedRef.current = true;
            close(false);
          }
        }}
        onBlur={() => close(true)}
        className={
          "h-7 w-44 rounded-md border border-primary/50 bg-background px-2 " +
          "text-center text-xs font-semibold text-foreground shadow-lg " +
          "outline-none ring-2 ring-ring/40"
        }
        style={{ fontFamily: "var(--font-sans, Vazirmatn, sans-serif)" }}
      />
    </div>
  );
}
