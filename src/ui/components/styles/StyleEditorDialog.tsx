"use client";

/**
 * The style editor dialog (R13.3): create/edit/delete USER styles
 * (built-ins are read-only). An edit re-renders every usage through the
 * deterministic old-value planner (local overrides survive — AC13.4) as
 * ONE composite undo step.
 */
import { useEffect, useState, type ReactElement } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Application, Services } from "@/App";
import { AppContext } from "@/AppContext";
import {
  StyleRegistry,
  planStyleEdit,
  type NamedStyle,
  type StyleKind,
  type TextStyleDef,
  type ColorStyleDef,
} from "@/core/knowledge/StyleRegistry";
import { UpdateObjectCommand } from "@/core/commands/UpdateObjectCommand";
import { CompositeCommand } from "@/core/commands/CompositeCommand";
import { useUiStore } from "@/ui/store/uiStore";
import { useTranslation } from "@/ui/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * @returns the style editor dialog (mounted by the AppShell).
 */
export default function StyleEditorDialog(): ReactElement | null {
  const { t } = useTranslation();
  const open = useUiStore((state) => state.styleEditorOpen);
  const setOpen = useUiStore((state) => state.setStyleEditorOpen);
  const [registry, setRegistry] = useState<StyleRegistry | undefined>(
    undefined,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [fontSize, setFontSize] = useState(20);
  const [fontWeight, setFontWeight] = useState(400);
  const [fill, setFill] = useState("#4bd39a");
  const [stroke, setStroke] = useState("#0f766e");
  const [kind, setKind] = useState<StyleKind>("text");

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void Application.boot().then((context: AppContext) => {
      if (!cancelled) {
        setRegistry(context.get(Services.styles));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open || registry === undefined) {
    return null;
  }

  const userStyles = registry.list().filter((style) => !style.builtin);

  const loadStyle = (style: NamedStyle): void => {
    setSelectedId(style.id);
    setName(style.name);
    setKind(style.kind);
    if (style.kind === "text") {
      const def = style.def as TextStyleDef;
      setFontSize(def.fontSize ?? 20);
      setFontWeight(def.fontWeight ?? 400);
    } else {
      const def = style.def as ColorStyleDef;
      setFill(def.fill ?? "#4bd39a");
      setStroke(def.stroke ?? "#0f766e");
    }
  };

  const buildDef = (): TextStyleDef | ColorStyleDef =>
    kind === "text"
      ? { fontSize, fontWeight }
      : { fill, stroke };

  const persist = (): void => {
    const trimmed = name.trim();
    if (trimmed === "") {
      return;
    }
    const context = AppContext.getDefault();
    const scene = context.tryGet(Services.scene);
    const history = context.tryGet(Services.history);
    if (scene === undefined || history === undefined) {
      return;
    }
    const id = selectedId ?? registry.nextUserId(kind);
    const nextStyle: NamedStyle = {
      id,
      kind,
      name: trimmed,
      builtin: false,
      def: buildDef(),
    };
    const oldStyle = selectedId !== null ? registry.byId(selectedId) : null;
    registry.upsertUserStyle(nextStyle);
    // An EDIT re-renders every usage (overrides survive — AC13.4).
    if (oldStyle !== null && oldStyle.kind === nextStyle.kind) {
      const usages = scene.objects.filter(
        (object) => (object as { styleId?: unknown }).styleId === id,
      );
      const patches = planStyleEdit(oldStyle, nextStyle, usages);
      const byObject = new Map<string, Record<string, unknown>>();
      for (const patch of patches) {
        const bucket = byObject.get(patch.objectId) ?? {};
        bucket[patch.field] = patch.value;
        byObject.set(patch.objectId, bucket);
      }
      const commands: UpdateObjectCommand[] = [];
      for (const usage of usages) {
        const patch = byObject.get(usage.id);
        if (patch === undefined) {
          continue;
        }
        const command = new UpdateObjectCommand(
          scene,
          usage.id,
          patch,
          usage,
        );
        command.do();
        commands.push(command);
      }
      if (commands.length > 0) {
        history.push(new CompositeCommand("command.editStyle", commands));
      }
    }
    setSelectedId(id);
  };

  const remove = (id: string): void => {
    registry.deleteUserStyle(id);
    if (selectedId === id) {
      setSelectedId(null);
      setName("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("styles.editorTitle")}</DialogTitle>
        </DialogHeader>
        <ul className="max-h-32 space-y-1 overflow-y-auto panel-scroll">
          {userStyles.map((style) => (
            <li
              key={style.id}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2 py-1.5"
            >
              <button
                type="button"
                onClick={() => loadStyle(style)}
                className="flex-1 truncate text-right text-[11px] font-medium"
              >
                {style.name}
                <span className="ms-2 text-[9px] text-muted-foreground">
                  {style.kind === "text" ? t("styles.kindText") : t("styles.kindColor")}
                </span>
              </button>
              <button
                type="button"
                aria-label={t("styles.delete")}
                onClick={() => {
                  remove(style.id);
                }}
                className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
          {userStyles.length === 0 && (
            <li className="px-2 py-1 text-[11px] text-muted-foreground">
              {t("styles.noUser")}
            </li>
          )}
        </ul>
        <div className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-foreground">
              {selectedId !== null
                ? t("styles.editingExisting")
                : t("styles.newStyle")}
            </span>
            <div className="flex gap-1">
              {(["text", "color"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setKind(option);
                    setSelectedId(null);
                  }}
                  className={
                    kind === option
                      ? "rounded-md bg-primary/15 px-2 py-1 text-[10px] font-medium text-primary"
                      : "rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent"
                  }
                >
                  {option === "text"
                    ? t("styles.kindText")
                    : t("styles.kindColor")}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[11px]">
            <span className="w-14 text-muted-foreground">{t("styles.nameLabel")}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-7 flex-1 rounded border border-border/60 bg-background px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </label>
          {kind === "text" ? (
            <>
              <label className="flex items-center gap-2 text-[11px]">
                <span className="w-14 text-muted-foreground">{t("styles.sizeLabel")}</span>
                <input
                  type="number"
                  min={8}
                  max={96}
                  value={fontSize}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (Number.isFinite(parsed) && parsed >= 8 && parsed <= 96) {
                      setFontSize(parsed);
                    }
                  }}
                  className="h-7 w-20 rounded border border-border/60 bg-background px-2 text-[11px]"
                />
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                <span className="w-14 text-muted-foreground">{t("styles.weightLabel")}</span>
                <select
                  value={fontWeight}
                  onChange={(event) => {
                    setFontWeight(Number(event.target.value));
                  }}
                  className="h-7 rounded border border-border/60 bg-background px-2 text-[11px]"
                >
                  <option value={400}>{t("styles.weightNormal")}</option>
                  <option value={700}>{t("styles.weightBold")}</option>
                </select>
              </label>
            </>
          ) : (
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-[11px]">
                <span className="text-muted-foreground">{t("styles.fillLabel")}</span>
                <input
                  type="color"
                  value={fill}
                  onChange={(event) => {
                    setFill(event.target.value);
                  }}
                  className="h-7 w-10 rounded border border-border/60 bg-background"
                />
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                <span className="text-muted-foreground">{t("styles.strokeLabel")}</span>
                <input
                  type="color"
                  value={stroke}
                  onChange={(event) => {
                    setStroke(event.target.value);
                  }}
                  className="h-7 w-10 rounded border border-border/60 bg-background"
                />
              </label>
            </div>
          )}
          <Button type="button" onClick={persist} className="w-full gap-2">
            <Plus className="size-4" aria-hidden="true" />
            {selectedId !== null ? t("styles.saveStyle") : t("styles.createStyle")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
