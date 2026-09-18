"use client";

/**
 * Core panel + inspector-section registrations (R7.1/R7.2): the six
 * first-party dock panels (Layers, Inspector, Search, Outline, Minimap,
 * Insert) and the inspector sections, registered onto the app's
 * `PanelRegistry` / `InspectorSectionRegistry`.
 *
 * Idempotent: every registration checks `has()` first, so hosts can call
 * {@link ensurePanelsRegistered} freely (StrictMode double-mount safe).
 * A registration IS the seam — the layout and inspector shell render from
 * the registries and never name these components.
 */
import type { AppContext } from "@/AppContext";
import { Services } from "@/App";
import type { PanelRegistry } from "@/ui/registry/PanelRegistry";
import type { InspectorSectionRegistry } from "@/ui/registry/InspectorSectionRegistry";
import LayersPanelBody from "@/ui/components/panels/LayersPanel";
import InspectorPanelBody from "@/ui/components/panels/InspectorPanel";
import SearchPanelBody from "@/ui/components/panels/SearchPanel";
import OutlinePanelBody from "@/ui/components/panels/OutlinePanel";
import MinimapPanelBody from "@/ui/components/panels/MinimapPanel";
import InsertPanelBody from "@/ui/components/panels/InsertPanel";
import HistoryPanelBody from "@/ui/components/panels/HistoryPanel";
import PluginManagerPanelBody from "@/ui/components/panels/PluginManagerPanel";
import AutomationPanelBody from "@/ui/components/panels/AutomationPanel";
import {
  ConnectorSection,
  FillSection,
  GeometrySection,
  MultiTextSection,
  NameSection,
  RichTextSection,
  StickySection,
  StickerSection,
  StrokeSection,
  TextBoxSection,
} from "@/ui/components/panels/inspector/sections";
import ImageSection from "@/ui/components/panels/inspector/ImageSection";
import PinSection from "@/ui/components/panels/inspector/PinSection";
import FrameLayoutSection from "@/ui/components/panels/inspector/FrameLayoutSection";
import KnowledgeSection from "@/ui/components/panels/inspector/KnowledgeSection";
import PropertiesSection from "@/ui/components/panels/inspector/PropertiesSection";
import QuerySection from "@/ui/components/panels/inspector/QuerySection";
import KnowledgeGraphPanelBody from "@/ui/components/panels/KnowledgeGraphPanel";
import TagPanePanelBody from "@/ui/components/panels/TagPanePanel";
import StylePickerSection from "@/ui/components/styles/StylePickerSection";

/**
 * Registers the core dock panels + inspector sections (idempotent).
 *
 * @param context - the booted application context.
 */
export function ensurePanelsRegistered(context: AppContext): void {
  registerCorePanels(context.get(Services.panels));
  registerCoreInspectorSections(context.get(Services.inspectorSections));
}

/**
 * Registers the six first-party dock panels (idempotent).
 *
 * @param registry - the panel registry.
 */
function registerCorePanels(registry: PanelRegistry): void {
  const panels = [
    {
      id: "core.panels.outline",
      titleKey: "panels.outline",
      icon: "ListTree",
      component: OutlinePanelBody,
      placement: "left" as const,
      order: 10,
      defaultOpen: false,
    },
    {
      id: "core.panels.insert",
      titleKey: "panels.insert",
      icon: "LayoutGrid",
      component: InsertPanelBody,
      placement: "left" as const,
      order: 20,
      defaultOpen: true,
    },
    {
      id: "core.panels.layers",
      titleKey: "panels.layers",
      icon: "Layers",
      component: LayersPanelBody,
      placement: "right" as const,
      order: 10,
      defaultOpen: false,
    },
    {
      id: "core.panels.inspector",
      titleKey: "panels.inspector",
      icon: "SlidersHorizontal",
      component: InspectorPanelBody,
      placement: "right" as const,
      order: 20,
      defaultOpen: false,
    },
    {
      id: "core.panels.search",
      titleKey: "panels.search",
      icon: "Search",
      component: SearchPanelBody,
      placement: "right" as const,
      order: 30,
      defaultOpen: false,
    },
    {
      id: "core.panels.history",
      titleKey: "panels.history",
      icon: "History",
      component: HistoryPanelBody,
      placement: "right" as const,
      order: 40,
      defaultOpen: false,
    },
    {
      id: "core.panels.plugins",
      titleKey: "panels.plugins",
      icon: "Puzzle",
      component: PluginManagerPanelBody,
      placement: "right" as const,
      order: 50,
      defaultOpen: false,
    },
    {
      id: "core.panels.automations",
      titleKey: "panels.automations",
      icon: "Zap",
      component: AutomationPanelBody,
      placement: "right" as const,
      order: 55,
      defaultOpen: false,
    },
    {
      // R15.1: the knowledge-graph overview panel.
      id: "core.panels.knowledgeGraph",
      titleKey: "panels.knowledgeGraph",
      icon: "Network",
      component: KnowledgeGraphPanelBody,
      placement: "right" as const,
      order: 57,
      defaultOpen: false,
    },
    {
      // Pack R11.4: the tag pane (live counts → search filter).
      id: "core.panels.tags",
      titleKey: "panels.tags",
      icon: "Hash",
      component: TagPanePanelBody,
      placement: "right" as const,
      order: 58,
      defaultOpen: false,
    },
    {
      id: "core.panels.minimap",
      titleKey: "panels.minimap",
      icon: "Map",
      component: MinimapPanelBody,
      placement: "bottom" as const,
      order: 10,
      defaultOpen: false,
    },
  ];
  for (const panel of panels) {
    if (!registry.has(panel.id)) {
      registry.register(panel);
    }
  }
}

/**
 * Registers the core inspector sections (idempotent).
 *
 * @param registry - the inspector-section registry.
 */
function registerCoreInspectorSections(
  registry: InspectorSectionRegistry,
): void {
  const sections = [
    {
      id: "core.inspector.name",
      target: "*",
      component: NameSection,
      order: 10,
    },
    {
      id: "core.inspector.multiText",
      target: "text",
      component: MultiTextSection,
      order: 15,
    },
    {
      id: "core.inspector.stroke",
      target: "*",
      component: StrokeSection,
      order: 20,
    },
    {
      id: "core.inspector.connector",
      target: "connector",
      component: ConnectorSection,
      order: 30,
    },
    {
      id: "core.inspector.fill",
      target: "shape",
      component: FillSection,
      order: 40,
    },
    {
      id: "core.inspector.textBox",
      target: "textBox",
      component: TextBoxSection,
      order: 50,
    },
    {
      id: "core.inspector.richText",
      target: "text",
      component: RichTextSection,
      order: 60,
    },
    {
      id: "core.inspector.sticky",
      target: "stickyNote",
      component: StickySection,
      order: 70,
    },
    {
      id: "core.inspector.sticker",
      target: "sticker",
      component: StickerSection,
      order: 75,
    },
    {
      id: "core.inspector.geometry",
      target: "*",
      component: GeometrySection,
      order: 80,
    },
    {
      // Phase 23 «پل کلیپ‌بورد»: the original-size contract — natural
      // size/scale/ratio readouts + the two reset affordances.
      id: "core.inspector.image",
      target: "image",
      component: ImageSection,
      order: 82,
    },
    {
      // فاز ۲۵ «سنجاش روی صفحه»: the screen-pin toggle + the 3×3
      // position grid (single pinnable selections).
      id: "core.inspector.pin",
      target: "*",
      component: PinSection,
      order: 83,
    },
    {
      // R13.4: the frame auto-layout section.
      id: "core.inspector.frameLayout",
      target: "frame",
      component: FrameLayoutSection,
      order: 85,
    },
    {
      // R13.3: the named-style picker (text + colour surfaces).
      id: "core.inspector.styles",
      target: "*",
      component: StylePickerSection,
      order: 90,
    },
    {
      // Pack R11.8: the structured properties editor (all object kinds).
      id: "core.inspector.properties",
      target: "*",
      component: PropertiesSection,
      order: 93,
    },
    {
      // Pack-Phase-11 rebuild: wiki links, backlinks and tags.
      id: "core.inspector.knowledge",
      target: "*",
      component: KnowledgeSection,
      order: 95,
    },
    {
      // R15.2: the live query-card editor + result rows.
      id: "core.inspector.query",
      target: "query",
      component: QuerySection,
      order: 60,
    },
  ];
  for (const section of sections) {
    if (!registry.has(section.id)) {
      registry.register(section);
    }
  }
}
