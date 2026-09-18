import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration (CLAUDE.md §1.2: Vitest is the project test runner).
 *
 * `tests/` mirrors the `src/` structure; coverage gates enforce ≥90% on the
 * fully implemented core modules (Phase 0: EventBus).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/core/events/EventBus.ts',
        'src/core/geometry/Vec2.ts',
        'src/core/geometry/BBox.ts',
        'src/core/geometry/transforms.ts',
        'src/core/geometry/hitTest.ts',
        'src/core/geometry/resize.ts',
        'src/core/camera/Camera.ts',
        'src/core/camera/CameraController.ts',
        'src/core/model/Scene.ts',
        'src/core/model/Anchors.ts',
        'src/core/model/ConnectorObject.ts',
        'src/core/id/IdGenerator.ts',
        'src/persistence/ProjectFile.ts',
        'src/persistence/VersionedSerializer.ts',
        'src/persistence/migrations/index.ts',
        'src/persistence/StorageBackend.ts',
        'src/persistence/AutosaveService.ts',
        'src/core/history/HistoryManager.ts',
        'src/core/commands/AddObjectCommand.ts',
        'src/core/commands/RemoveObjectCommand.ts',
        'src/core/commands/CompositeCommand.ts',
        'src/core/commands/MoveCommand.ts',
        'src/core/commands/ResizeCommand.ts',
        'src/core/commands/UpdateObjectCommand.ts',
        'src/core/commands/ReorderCommand.ts',
        'src/core/commands/Coalescer.ts',
        'src/core/commands/StylePatches.ts',
        'src/core/selection/Selection.ts',
        'src/core/model/SceneObject.ts',
        'src/text/editor/wordCount.ts',
        'src/text/editor/pastePlanner.ts',
        'src/text/find/FindReplaceModel.ts',
        'src/text/find/TextReplaceService.ts',
        'src/ui/i18n/numbers.ts',
        'src/core/registry/Registry.ts',
        'src/core/registry/CommandRegistry.ts',
        'src/core/model/ShapeObject.ts',
        'src/core/model/TextBoxObject.ts',
        'src/core/model/StickyNoteObject.ts',
        'src/text/commands/TextCommit.ts',
        'src/rendering/ShapeOverlay.ts',
        'src/rendering/ConnectorOverlay.ts',
        'src/interaction/MarqueeLogic.ts',
        'src/interaction/StickyTool.ts',
        'src/interaction/ConnectorTool.ts',
        'src/interaction/SelectTool.ts',
        'src/interaction/objectHitTest.ts',
        // ── Phase 4 (R4): persistence + the object registry. The
        // browser/Tauri-only halves of the export pipeline
        // (DomRasterizer's font collection + SVG rasterization, the
        // Tauri IPC storage, exportToPng's DOM compositing) are verified
        // LIVE (agent-browser E2E: fonts embedded, bidi text, rotated
        // boxes, transparent background) — their PURE planning surfaces
        // (bounds, HTML builder, CSS, typed errors) are unit-tested and
        // gated through PngExporter's covered lines above via the tests;
        // the whole-file browser paths stay outside the node gate.
        'src/core/registry/ObjectRegistry.ts',
        'src/persistence/objectTypes.ts',
        'src/persistence/migrations/MigrationV1toV2.ts',
        'src/persistence/DocumentService.ts',
        'src/persistence/RecentFilesService.ts',
        'src/persistence/pathNames.ts',
        // ── Phase 8 (R8): the pure halves of the polish/distribution
        // modules. Jalali, i18n merging, the settings registry, frame
        // geometry/hit-tests, presentation planning, the template
        // builders, the DbAccess namespacing gate and the version
        // history are fully node-testable; the DOM halves (rasterized
        // SVG text, the print window, fullscreen) are verified live.
        'src/core/utils/jalali.ts',
        'src/core/model/FrameObject.ts',
        'src/core/presentation/Presentation.ts',
        'src/core/templates/templates.ts',
        'src/core/db/DbAccess.ts',
        'src/core/history/VersionHistoryService.ts',
      ],
      reporter: ['text', 'text-summary'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
