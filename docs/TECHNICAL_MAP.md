# نقشهٔ فنی دقیق — راهنمای توسعه‌دهندگان

> این سند می‌گوید **هر ویژگی کجاست** و **برای افزودن یا اصلاح هر چیز به کدام فایل‌ها مراجعه کنید**.
> همراه‌هایش: [`SEAMS.md`](./SEAMS.md) (نقاط توسعه)، [`CONTRACTS.md`](./CONTRACTS.md) (قراردادهای داده)، [`PLUGINS.md`](./PLUGINS.md) (نویسندگی افزونه)، [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md)، `DECISIONS.md` ریشه (۶۵+ تصمیم معماری مستند).

---

## ۰) خلاصهٔ فنی

| | |
|---|---|
| پوستهٔ وب | **Next.js 16** (App Router, `src/app/`) — React 19، SSR با `lang="fa" dir="rtl"` |
| پوستهٔ دسکتاپ | **Tauri 2** (`src-tauri/`) — پوستهٔ Rust + WebView2؛ فرانت‌اند با **Vite** بیلد می‌شود (`vite build` → `dist/`) |
| UI | React 19 + Tailwind 4 + کامپوننت‌های Radix + Lucide icons |
| بوم | **Canvas2D** دستی (بدون کتابخانهٔ بوم) + لایه‌های DOM برای متن/اوورلی |
| متن غنی | **TipTap 2** (ProseMirror) با اکستنشن‌های اختصاصی |
| رسانه | **pdf.js 6** (worker در `public/pdfjs/`) + **ffmpeg.wasm** (تبدیل آفلاین) |
| تست | **Vitest 5** — ۲۱۸ فایل / ۲٬۴۴۴ تست (node + jsdom) |
| زبان | TypeScript strict — `tsc --noEmit` باید همیشه پاک باشد |
| پکیج‌منیجر | npm یا bun (قفل روی `bun.lock`) |

**قانون طلایی معماری**: یک کد مشترک، دو پوسته. تنها جایی که «دسکتاپ بودن» تشخیص داده می‌شود تعداد انگشت‌شمار گارد `isTauriEnvironment()` است (مهم‌تر از همه: انتخاب AssetStore در `App.ts`). بقیهٔ کد پلتفرم‌ناشناس است.

---

## ۱) نقشهٔ کامل دایرکتوری‌ها

```
infinite-canvas-studio/
├─ src/
│  ├─ App.ts                     ★ ریشهٔ ترکیب (composition root) — ساخت همهٔ سرویس‌ها،
│  │                               رجیستری‌ها، ابزارها، وایرینگ فرمان‌ها و رویدادهای کیبورد
│  ├─ AppContext.ts              ★ سرویس‌لوکِر تایپ‌دار (Services) — دسترسی همهٔ ماژول‌ها
│  ├─ main.tsx                   ورود Vite/Tauri (دسکتاپ)
│  ├─ Logger.ts                  لاگر با sink
│  ├─ app/                       پوستهٔ Next.js: page.tsx، layout.tsx، globals.css
│  │   └─ api/                   ★ APIهای محلی پوستهٔ وب:
│  │       ├─ route.ts           خلاصهٔ API
│  │       ├─ fs/                لیست/بررسی ریشه‌های مجاز دیسک (serverFs)
│  │       └─ assets/            CRUD رسانه‌ها: write/read/exists/relocate/list (serverAssets)
│  ├─ core/                      ★ مغز برنامه — خالص و تست‌پذیر (بدون React/DOM)
│  │   ├─ model/                 شیءهای صحنه: Scene, SceneObject + ۱۹ نوع
│  │   │                         (TextBox, StickyNote, Shape, Freehand, Connector,
│  │   │                          Image, Video, Audio, Pdf, Sticker, Frame, Group,
│  │   │                          Opaque, Plugin, Query + Pinned/NameBadge/Properties/Anchors)
│  │   ├─ geometry/              Vec2, BBox, hit-test, transforms, resize, smoothing
│  │   ├─ camera/                Camera + CameraController (پن/زوم/چرخش)
│  │   ├─ commands/              ★ همهٔ عملیات قابل واگرد: Add/Remove/Move/Resize/
│  │   │                         Rotate/Reorder/Group/UpdateObject/Composite/Coalescer
│  │   │                         + StylePatches + AlignDistribute + ZOrderOps + LinkCommands
│  │   ├─ history/               HistoryManager (undo/redo) + VersionHistoryService
│  │   ├─ registry/              ★ CommandRegistry، ObjectRegistry، Registry پایه،
│  │   │                         ContextMenuRegistry
│  │   ├─ events/                EventBus تایپ‌دار (نقشهٔ رویدادها در فایل)
│  │   ├─ interaction→../..      (ابزارها در src/interaction/)
│  │   ├─ clipboard/             SelectionClipboard + DropPayload (پل انتقال)
│  │   ├─ selection/             Selection (مدل)
│  │   ├─ spatial/               Linear/RTree/Scene SpatialIndex
│  │   ├─ search/                SceneSearch + فیلترها
│  │   ├─ bookmarks/             BookmarkService
│  │   ├─ stickers/              StickerLibrary + RecentStickers + StickerInsert
│  │   ├─ templates/             قالب‌های پروژه (کانبان و…)
│  │   ├─ presentation/          موتور حالت ارائه
│  │   ├─ minimap/               محاسبهٔ نقشهٔ بوم
│  │   ├─ knowledge/            ★ لایهٔ دانش: KnowledgeService, KnowledgeIndex,
│  │   │                         WikiLinks, QueryEngine, LinkRegistry, GraphLayout,
│  │   │                         GraphArrange, PropertySchemaStore, StyleRegistry
│  │   ├─ db/                    DbAccess (نیم‌فضای core_ برای SQL نسخه‌ها)
│  │   └─ utils/                 jalali و ابزارها
│  ├─ interaction/              ★ ابزارها و لایهٔ فرمان
│  │   ├─ ToolManager.ts         فعال‌سازی ابزار با رویداد ui:tool-changed
│  │   ├─ Tool.ts                اینترفیس Tool (onPointerDown/Move/Up/KeyDown/Cancel)
│  │   ├─ SelectTool.ts          انتخاب/جابه‌جایی/ریسایز/چرخش/مارکی/دابل‌کلیک
│  │   ├─ ShapeTool, PenTool, EraserTool, TextTool, StickyTool, TableTool,
│  │   │  ConnectorTool, HandTool
│  │   ├─ SnapEngine.ts, SmartGuides.ts, MarqueeLogic.ts, objectHitTest.ts
│  │   ├─ ResizeGesture.ts, RotateGesture.ts, PinResizeGesture.ts, PinRotateGesture.ts
│  │   ├─ StickerInsert.ts, CatalogInsert.ts   ← درج از کارت کاتالوگ (کلیک/درگ)
│  │   └─ dispatch/
│  │       ├─ CommandDispatcher.ts  ★ قیف واحد اجرای فرمان
│  │       ├─ commands.ts          ★ کاتالوگ core.* (~۷۰ فرمان + میان‌برها)
│  │       └─ CoreCommandWiring.ts  اتصال فرمان→رفتار UI
│  ├─ rendering/                ★ رندر Canvas2D
│  │   ├─ Canvas2DRenderer.ts   جدول canvasDrawers per-kind + حلقهٔ رندر
│  │   ├─ RenderLoop.ts         زمان‌بندی فریم‌ها
│  │   ├─ GridRenderer, ShapeOverlay, StrokeOverlay, ConnectorOverlay,
│  │   │  GuidesOverlay, HandlesRenderer, KnowledgeEdgeOverlay, StaticTextCache
│  │   └─ DomRasterizer.ts      رستر DOM برای خروجی تصویری (متن/فونت)
│  ├─ text/                     ★ ویرایشگر متن غنی
│  │   ├─ editor/               TipTap: TipTapFactory, extensions/ (Direction,
│  │   │                        ListIndent, FormatPainter…), pastePlanner,
│  │   │                        pasteSanitizer (مرز امنیتی!), tableCommands
│  │   ├─ commands/             RichTextCommand, TextCommit (کامیت=یک Undo)
│  │   ├─ view/                 TextMetrics + TextLayerView (اوورلی DOM متن)
│  │   └─ find/                 FindReplaceModel, TextReplaceService
│  ├─ media/                   ★ رسانه
│  │   ├─ PdfRenderer.ts       پوشش تنبل pdf.js (worker از public/pdfjs)
│  │   ├─ PdfPageCache.ts      کش (asset,page)→poster-hash (ورق‌برگشت بدون رندر مجدد)
│  │   ├─ PosterBitmapCache.ts  کش بیت‌مپ اشتراکی پوسترها
│  │   ├─ ThumbnailService.ts, FormatProbe.ts (سه‌طرفه: پذیرش/تبدیل/رد)
│  │   ├─ VideoConverter.ts, AudioConverter.ts  ← ffmpeg.wasm آفلاین
│  │   ├─ WaveformGenerator.ts  موج صدا
│  │   ├─ AssetUrlResolver.ts   hash → URL (وب: /api/assets، دسکتاپ: icbasset://)
│  │   └─ videoFormats/audioFormats/pdfFormats.ts  فهرست قالب‌ها
│  ├─ persistence/             ★ ذخیره‌سازی
│  │   ├─ ProjectFile.ts        ساختار .icb + بامپ نسخه (v6)
│  │   ├─ VersionedSerializer.ts سریال‌سازی + دیسپچ رجیستری
│  │   ├─ migrations/           MigrationV1toV2 … V5toV6 (زنجیرهٔ خودکار)
│  │   ├─ objectTypes.ts        ★ ثبت نوع‌های core.* در ObjectRegistry
│  │   ├─ AssetStore.ts         اینترفیس + WebAssetStore (وب) + hash
│  │   ├─ TauriAssetStore.ts    ★ دوقلوی دسکتاپ (IPC + convertFileSrc)
│  │   ├─ assetPaths.ts         sidecar `<فایل>.icb.assets/` + media-inbox
│  │   ├─ AutosaveService.ts    تایمر ۳۰ث + فلوش
│  │   ├─ StorageBackend.ts + TauriAppDataStorage.ts + WebStorageBackend (اسلات‌ها)
│  │   ├─ SaveToDisk.ts / LoadFromDisk.ts / DocumentService.ts
│  │   ├─ RecentFilesService.ts, MarkdownInterop.ts, LocalFsBridge.ts, pathNames.ts
│  │   └─ exporters/            Png, Svg, Pdf, Word (w:tbl واقعی), DomRasterizer
│  ├─ platform/tauri/           دیالوگ/فایل/لاگ دسکتاپ (TauriDialog, deeplink…)
│  ├─ plugins/                ★ اجراپیمای افزونه
│  │   ├─ manifest.ts          اعتبارسنجی manifest.json
│  │   ├─ host/                PluginRuntime, SandboxHost, PermissionEngine,
│  │   │                        LifecycleManager, PluginStore, PluginStorage,
│  │   │                        PluginObjectLayer, pluginCatalog, readPackage
│  │   ├─ sdk/createPluginSdk.ts  شیم رسمی SDK
│  │   └─ protocol.ts          پل JSON نسخه‌دار (v1)
│  ├─ datahub/                 DataHub + قراردادها + اتوماسیون‌ها
│  ├─ ui/                      ★ رابط React
│  │   ├─ components/          AppShell، CanvasSurface، StatusBar، DocumentTitleBar،
│  │   │                        ProjectMenu، ContextMenuHost، PresentationView،
│  │   │                        دیالوگ‌ها (Insert*/Convert*/Export*/SaveAt/OpenAt/
│  │   │                        Settings/TemplateGallery/StickerPicker/LinkTargetPicker/
│  │   │                        Recovery/UnsavedConfirm/MarkdownInterop/ConnectorLabel)
│  │   │   └─ panels/          فایل هر پنل (بالا) + PanelContainer + registerPanels
│  │   │       └─ inspector/   بخش‌های بازرس per-kind (sections)
│  │   ├─ player/              ★ پنجره‌های شناور: FloatingPlayerWindow (ویدئو)،
│  │   │                        FloatingMiniPlayer (صوت)، FloatingPdfViewer (سند) +
│  │   │                        playerSettings/miniPlayerSettings/pdfViewerSettings +
│  │   │                        titleBarDrag.ts (درگ نوار عنوان — گارد تعامل) +
│  │   │                        textLayerSelection.ts (ماشین انتخاب متن PDF)
│  │   ├─ palette/             CommandPalette (فقط از CommandRegistry رندر می‌کند)
│  │   ├─ registry/             PanelRegistry، InspectorSectionRegistry، SettingsSectionRegistry
│  │   ├─ settings/             بخش‌ها + registerSettings + settingsPersistence (APP data)
│  │   ├─ i18n/                 fa.ts (منبع کلیدها), en.ts, numbers.ts (ارقام فارسی), index
│  │   ├─ contextMenu/          contributions.ts (کاتالوگ منوی راست‌کلیک)
│  │   ├─ clipboard/            پل حافظهٔ سیستم (in/out) + انتخاب→تصویر
│  │   ├─ hooks/                useCanvasShortcuts، useToolShortcuts، useImageImport
│  │   │                        (قیف واحد درج رسانه!)، useRichTextSession…
│  │   ├─ store/                uiStore (zustand): ابزار فعال، پنجرهٔ شناورِ باز، دیالوگ‌ها
│  │   ├─ stickers/،theme/،text/ پشتیبانی UI
│  └─ lib/serverFs.ts + serverAssets.ts  ← منطق API مسیر/رسانه (وب)
├─ src-tauri/                  ★ پوستهٔ Rust
│  ├─ tauri.conf.json          پیکربندی (NSIS، dragDropEnabled:false، نسخه)
│  ├─ src/main.rs + lib.rs      ۵ فرمان فایل + ثبت ماژول‌ها
│  └─ src/assets.rs            ★ پروتکل icbasset:// + IPC: asset_write_chunk/
│                               asset_exists/asset_relocate (تلفیق TauriAssetStore.ts)
├─ public/
│  ├─ pdfjs/                   worker + cmaps + فونت‌های استاندارد (لازم برای CJK/عربی)
│  ├─ ffmpeg/                  ffmpeg-core.wasm (~31MB) + js — مبدل آفلاین
│  ├─ qa/                      فیکسچرهای تست رسانه‌ای (PDF/MP4/MP3/خراب/اسکن…)
│  ├─ templates/               قالب‌های .icb (کانبان…)
│  ├─ plugins-sample/           افزونهٔ نمونه (Sticky Shape Pack)
│  └─ plugins-firstparty/       ۵ افزونهٔ داخلی (تقویم/برنامه‌ریز/گزارش‌گر/تحلیلگر/یادداشت)
├─ tests/                     ★ ۲۱۸ فایل — آینهٔ ساختار src (core/interaction/text/
│                              rendering/persistence/media/plugins/knowledge/datahub/ui…)
├─ scripts/                   build-snapshot*.sh، desktop-sim/server.js (شبیه‌ساز exe)،
│                              generateTemplates.ts
├─ prisma/schema.prisma        اسکیمای DB — در اجرا استفاده نمی‌شود (پسماند؛ مجوز import ندارد)
├─ docs/                       همین اسناد + SEAMS/CONTRACTS/PLUGINS/KNOWN_LIMITATIONS
└─ DECISIONS.md / CHANGELOG.md / THIRD_PARTY_NOTICES.md
```

---

## ۲) جریان‌های اصلی (Data Flow)

### الف) ورودی کاربر → صحنه → رندر
```
Pointer/Key روی CanvasSurface (ui/components)
  → Tool فعال (interaction/*Tool.ts)          [هندسه + hit-test]
  → Command (core/commands/*)                 [هر تغییر = یک Undo]
  → Scene.objects تغییر می‌کند (core/model)
  → EventBus 'scene:changed'
  → RenderLoop → Canvas2DRenderer (rendering/) + اوورلی‌های DOM
```

### ب) درج رسانه (تصویر/ویدئو/صوت/PDF) — قیف واحد
```
سه ورودی: دیالوگ درج | Drag&Drop | Ctrl+V   ← همه به useImageImport (ui/hooks)
  → FormatProbe (media/) رأی سه‌طرفه: پذیرش / نیاز به تبدیل / رد
     ├─ نیاز به تبدیل → ConvertVideo/ConvertAudioDialog (ffmpeg.wasm)
     └─ پذیرش → AssetStore.putBytes (hash sha256 محتوا = نام فایل)
  → AddObjectCommand با شیء مربوطه (Image/Video/Audio/PdfObject)
  → پوستر/موج: ThumbnailService / WaveformGenerator / PdfRenderer+PdfPageCache
```
- **وب**: `WebAssetStore` → `POST /api/assets/write` → `serverAssets.ts` روی دیسک.
- **دسکتاپ**: `TauriAssetStore` → `asset_write_chunk` IPC (چانک ۴MiB) → Rust می‌نویسد؛ خواندن از `icbasset://<hash>` با پشتیبانی Range/206 (seek ویدئو).

### ج) ذخیره و فراخوانی
```
AutosaveService (۳۰ث، dirty) ─┐
ProjectMenu «ذخیره» (Ctrl+S) ──┤
                               ├→ DocumentService → VersionedSerializer
                               │    → ObjectRegistry.serialize per-kind (typeId+typeVersion)
                               │    → ProjectFile (magic .icb, schemaVersion 6, plugins passthrough)
                               │    → SaveToDisk (وب: API/d selected path یا دانلود؛ دسکتاپ: Tauri)
                               │    → رسانه‌ها: AssetStore.syncProjectPath → relocate
                               │      (اولین Save-As: inbox→sidecar «انتقال»؛ بعدی: «کپی»)
                               └→ رویداد persistence:saved → آینهٔ Markdown (اختیاری)
بارگذاری: LoadFromDisk → VersionedSerializer.deserialize → زنجیرهٔ migrations v1→v6
          → نوع‌های ناشناخته = OpaqueObject (JSON خام حفظ می‌شود) → RecoveryDialog در صورت وجود autosave جدید‌تر
```

### د) اجرای فرمان (toolbar/منو/کیبورد/پالت — همیشه یک مسیر)
```
هر سطح فقط id می‌فرستد → CommandDispatcher.dispatch(id)
  → CommandRegistry.execute → CoreCommandWiring → رفتار واقعی
میان‌برها موقع ثبت بررسی تعارض می‌شوند (خطای ثبت + لاگ).
```

---

## ۳) رجیستری‌ها — قلب توسعه‌پذیری

| رجیستری | فایل | چه می‌دهد | برای افزودن |
|---|---|---|---|
| **CommandRegistry** | `src/core/registry/CommandRegistry.ts` | فرمان با id/titleKey/shortcut/group/execute | یک entry در `dispatch/commands.ts` + کلید i18n |
| **ObjectRegistry** | `src/core/registry/ObjectRegistry.ts` | **تنها نقطهٔ (de)serialization**: typeId، factory، serialize، migrations، **catalog** | یک فایل مدل + یک `register()` در `persistence/objectTypes.ts` + رسم در `Canvas2DRenderer` |
| **PanelRegistry** | `src/ui/registry/PanelRegistry.ts` | پنل داک با placement/order | کامپوننت + ثبت در `ui/panels/registerPanels.ts` |
| **InspectorSectionRegistry** | `src/ui/registry/InspectorSectionRegistry.ts` | بخش بازرس per-kind (exact→text→*) | `ui/components/panels/inspector/sections.tsx` |
| **SettingsSectionRegistry** | `src/ui/registry/SettingsSectionRegistry.ts` | بخش تنظیمات — دیالوگ از رجیستری رندر می‌کند | `ui/settings/sections.tsx` + ثبت |
| **ContextMenuRegistry** | `src/core/registry/ContextMenuRegistry.ts` | آیتم منوی راست‌کلیک زمینه‌ای | `ui/contextMenu/contributions.ts` |
| **EventBus** | `src/core/events/EventBus.ts` | رویداد تایپ‌دار بین ماژول‌ها | افزودن به نقشهٔ تایپ + emit/subscribe |
| **i18n mergeNamespace** | `src/ui/i18n/index.ts` | دیکشنری خارجی با مالک (`owner:key`) | افزونه‌ها خودشان merge می‌کنند |

**قانون §۱٫۷٫۱ (register-only)**: هیچ `switch(kind)` در کد (de)serialization مجاز نیست — همه‌چیز از رجیستری. قانون مشابه برای پنل/تنظیمات/منو: سطح رندر فقط از رجیستری می‌خواند.

---

## ۴) جدول مسیریابی «ویژگی → فایل» (برای اصلاح هر چیز)

| می‌خواهید… | فایل‌های اصلی | نکته‌ها |
|---|---|---|
| **شیء جدید روی بوم** | `core/model/<Kind>Object.ts` (جدید) + ثبت در `persistence/objectTypes.ts` + رسم در `rendering/Canvas2DRenderer.ts` (`canvasDrawers`) + انتخاب/هندسه در `core/model/SceneObject.ts` (اتحادیهٔ kind) + تست round-trip در `tests/persistence/objectTypes*.test.ts` | `catalog` بدهید تا کارت پنل درج خودکار بیاید؛ `CatalogInsert.ts` مسیر کلیک/درگ کارت است |
| **فرمان/میان‌بر جدید** | `interaction/dispatch/commands.ts` + کلید در `ui/i18n/fa.ts` و `en.ts` + رفتار در `CoreCommandWiring.ts`/`App.ts` | id = `core.<گروه>.<نام>`؛ میان‌بر با نُت `Mod-Shift-X`؛ تعارض موقع ثبت می‌ترکد |
| **پنل جدید** | کامپوننت در `ui/components/panels/` + ثبت در `ui/panels/registerPanels.ts` | placement چپ/راست/پایین؛ باز/بسته در localStorage می‌ماند |
| **بخش بازرس برای نوعی شیء** | `ui/components/panels/inspector/` | `target` دقیق kind بدهید؛ گرید مشترک از `Properties` مدل می‌آید |
| **تنظیم جدید** | `ui/settings/sections.tsx` + مقدار در استور تنظیمات + ماندگاری `settingsPersistence.ts` | بدون دکمهٔ Apply — همه‌چیز live |
| **نوع رسانهٔ جدید** | الگوی سه‌فایلی را کپی کنید: `media/<kind>Formats.ts` + probe در `media/FormatProbe.ts` + قیف در `ui/hooks/useImageImport.ts` + دیالوگ درج + `AssetStore` خودش generic است | فرمت PDF (فاز P1/P2) دقیقاً همین زنجیره است — بهترین نمونه |
| **خروجی جدید** | `persistence/exporters/<Kind>Exporter.ts` + اتصال در ProjectMenu/ExportDialog | متن‌ها از DomRasterizer/StaticTextCache |
| **کلید ترجمهٔ جدید** | `fa.ts` (منبع) **و** `en.ts` | `TranslationKey` از fa مشتق می‌شود — فراموش‌کردن en = خطای typecheck |
| **میان‌بر کیبورد بوم** | `ui/hooks/useCanvasShortcuts.ts` (فرمان‌ها) / `useToolShortcuts.ts` (کلید تکی ابزار) | گاردهای «ویرایشگر باز؟/modifier؟» اینجاست |
| **رفتار دابل‌کلیک روی شیء** | `interaction/SelectTool.ts` | نمونه: باز شدن نمایشگر رسانه |
| **پنجرهٔ شناور جدید** | `ui/player/<Name>.tsx` + وضعیت در `uiStore` + تنظیمات اسلات `*Settings.ts` | **حتماً** از `titleBarDrag.ts` برای درگ نوار عنوان استفاده کنید (درس fix1) |
| **مهاجرت فرمت فایل** | `persistence/migrations/MigrationV<N>toV<N+1>.ts` + بامپ `ProjectFile.ts` + تست | فایل‌های قدیمی باید بی‌صدا بالا بیایند |
| **قالب پروژهٔ جدید** | `scripts/generateTemplates.ts` → خروجی در `public/templates/*.icb` | فهرست در `core/templates/` |
| **افزودن افزونهٔ داخلی** | پوشهٔ `public/plugins-firstparty/<id>/` (manifest+entry+i18n) | الگو: افزونهٔ تقویم |
| **تغییر API وب** | `src/app/api/**/route.ts` + منطق در `src/lib/serverFs.ts`/`src/serverAssets.ts` | ریشه‌های مجاز دیسک در serverFs تعریف شده |
| **رفتار دسکتاپ Rust** | `src-tauri/src/assets.rs` + `lib.rs` | بعد از تغییر: `npm run tauri:build`؛ تست با desktop-sim |

---

## ۵) قراردادهای حیاتی

1. **i18n-only**: هیچ متن قابل‌نمایشی hard-code نمی‌شود — همه از `fa.ts`/`en.ts` با `t()`.
2. **Undo در یک قدم**: هر عمل کاربر باید دقیقاً یک entry تاریخچه بسازد (کامپوزیت/Coalescer برای ترکیب‌ها).
3. **رجیستری-only** برای انواع شیء/فرمان/پنل/تنظیمات — dispatch ساختاری ممنوع.
4. **رسانه = hash**: نام فایل رسانه همیشه sha256 هگز ۶۴رقمی است؛ URL‌ها با hash ساخته می‌شوند → جابه‌جایی پوشه لینک را نمی‌شکند.
5. **Unknown = Opaque**: نوع ناشناخته در فایل، placeholder می‌شود و JSON خامش در Save بعدی حفظ می‌شود.
6. **بخش `plugins: {}`** فایل passthrough است — هاست هرگز تفسیرش نمی‌کند.
7. **فارسی/RTL**: اعداد رابط با `ui/i18n/numbers.ts` فارسی می‌شوند؛ تاریخ با `core/utils/jalali`.
8. **افزوده‌ای (additive)**: قابلیت‌های موجود بدون بازنویسی ساختاری گسترش می‌یابند (قانون پروژه از فاز ۳ به بعد — رجوع به DECISIONS).
9. **آفلاین**: هستهٔ برنامه هیچ درخواست شبکه‌ای نمی‌زند؛ دسترسی شبکه فقط از افزونه با مجوز `network`.

---

## ۶) اجراپیمای افزونه (خلاصه — جزئیات در PLUGINS.md و SEAMS §9)

```
نصب: readPackage → manifest.ts (اعتبارسنجی کامل، خطاها جملهٔ فارسی)
     → رضایت مجوزها (PermissionEngine) → PluginStore ثبت → SandboxHost بالا
اجرا: iframe sandbox="allow-scripts" (بدون same-origin)
     ↔ پل JSON نسخه‌دار (protocol.ts): hello/ready/req/res/evt — قاب خراب fail-closed
مشارکت‌ها: app.commands/objects/panels/settings/storage(sql mini)/events/
     project(read-write بخش خودش)/i18n/scene(insertText/insertFrame/addLink/
     focusObject/notifyInfo)/network(fetch فقط خارجی)
جداسازی: هر پیام بر مجوز منبع ثبت‌شده چک می‌شود؛ خرابی افزونه هرگز اپ را نمی‌اندازد؛
     حذف = غیرفعال‌سازی + آرشیو داده + حذف لینک‌های مالک افزونه
```

---

## ۷) دسکتاپ (Tauri) — دوقلوی دقیق

| مفهوم | وب | دسکتاپ (exe) |
|---|---|---|
| ذخیرهٔ تنظیمات/autosave | localStorage | `appDataDir` (TauriAppDataStorage) — `C:\Users\<u>\AppData\Roaming\app.infinitecanvas.studio\` |
| رسانه پیش از Save | `/api/assets` + tmp سیستم | `asset_write_chunk` IPC + `appData/media-inbox` |
| خواندن رسانه | `/api/assets/read?hash=` | `icbasset://<hash>` (پروتکل Rust با Range/206) |
| انتخاب مسیر | File System Access / دانلود | پنجرهٔ سیستمی `tauri-plugin-dialog` |
| باز شدن فایل | — | deep-link: دابل‌کلیک `.icb` |

انتخاب twin فقط در `App.ts` با `isTauriEnvironment()` انجام می‌شود — **تنها** خط دسکتاپ‌آگاه پشتهٔ رسانه.

**شبیه‌ساز دسکتاپ بدون ویندوز**: `node scripts/desktop-sim/server.js` → باندل Vite + شیم `__TAURI_INTERNALS__` + دوقلوی Node پروتکل icbasset → برای تست مسیرهای exe قبل از بیلد واقعی.

---

## ۸) تست و کیفیت

```bash
npm run typecheck   # tsc --noEmit — باید صفر خطا باشد
npm run test         # vitest run — ۲۱۸ فایل / ۲٬۴۴۴ تست (~۵۵s)
npm run test:watch   # حالت واچ
npm run lint         # توجه: روی این ماشین ممکن است OOM شود؛ استاندارد پروژه:
                     #   npx eslint <فایل‌های تغییریافته>
npm run dev          # پوستهٔ وب :3000
npm run dev:web      # پوستهٔ Vite (نزدیک‌تر به بیلد دسکتاپ)
npm run build:web    # خروجی dist/ برای Tauri
npm run tauri:dev    # پنجرهٔ دسکتاپ hot-reload
npm run tauri:build  # NSIS + exe  (پیش‌نیاز: Rust + VS Build Tools)
```

ساختار تست‌ها آینهٔ src است (`tests/core/model/...` و…). الگوهای مهم:
- تست‌های DOM با `// @vitest-environment jsdom` (نمونه: `tests/ui/player/titleBarDrag.test.ts`).
- تست‌های CSS-قراردادی (نمونه: `tests/ui/player/pdfTextLayerCss.test.ts` — نگهبان قرارداد text layer).
- تست درون‌برنامه‌ای شبیه‌سازی دسکتاپ: `scripts/desktop-sim/server.js` + باندل `dist/`.

**گیت‌فلوی پیشنهادی**: branch → تغییر → typecheck+test+lint(تغییریافته‌ها) → PR. برای بیلد exe روی ویندوز: `npm install && npm run tauri:build`.

---

## ۹) تله‌های شناخته‌شده (لندمین‌ها — قبل از دست‌زدن بخوانید!)

1. **درگ نوار عنوان پنجره‌های شناور**: حتماً از `ui/player/titleBarDrag.ts` استفاده کنید. pointer-capture روی نوار عنوان باعث می‌شود کلیک دکمه‌های داخل نوار به خود نوار برود (باگ تاریخی fix1 — Esc همیشه کار می‌کرد و تست‌ها را فریب می‌داد).
2. **CSSOM shorthand**: در استایل اینلاین، `inset` بعد از `left/top` بیاید هر دو را **پاک می‌کند** (باگ «نمایشگر خارج از صفحه» P2). ترتیب پراپرتی‌ها در `style={{...}}` مهم است.
3. **قرارداد text layer pdf.js v6**: `.pdf-text-layer` در `globals.css` باید دقیقاً پل `--scale-factor`→`--total-scale-factor` + قواعد per-span را داشته باشد؛ حذفش = هایلایت کج و باکس‌های کلیک مرده (باگ فارسی fix2). ماشین انتخاب/کپی در `ui/player/textLayerSelection.ts` است — فولد presentation forms عربی تا U+FB50–FEFF گسترش یافته.
4. **`dragDropEnabled: false`** در `tauri.conf.json` الزامی است تا درگ‌اند‌دراپ اکسپلورر به WebView قورت داده نشود.
5. **tsconfig**: پوشهٔ `phase-changed/` (ساب‌ست تحویل فاز) در `exclude` است — آنجا سورس قابل کامپایل نیست.
6. **React Compiler**: deps آرایه‌های useEffect باید کامل باشد وگرنه «memoization could not be preserved» می‌گیرد.
7. **eslint کل درخت** روی ماشین‌های کم‌حافظه OOM می‌شود — استاندارد: lint فایل‌های تغییریافته.
8. **pdf.js assets**: `public/pdfjs/cmaps` + `standard_fonts` لازم‌اند (بدون‌شان CJK/عربیِ فایل‌های خاص خراب می‌شود)؛ worker از `public/pdfjs/pdf.worker.min.mjs`.
9. **ffmpeg.wasm** (~۳۱MB در `public/ffmpeg/`) — در GitHub مشکلی نیست (زیر سقف ۱۰۰MB) اما LFS لازم نیست؛ صرفاً clone را سنگین می‌کند.
10. **اعداد در UI**: همیشه از `numbers.ts` (فارسی‌سازی) استفاده کنید؛ نه `toLocaleString` خام.
11. **بازنویسی استایل‌های بوم در خروجی**: DomRasterizer فونت‌ها را با `document.fonts.ready` و XML-escape می‌بندد — متن فارسی SVG به‌صورت تصویر جاسازی می‌شود (عمدی، برای شکل‌دهی دقیق).
12. **Prisma** هیچ‌جا import نمی‌شود — DB در اجرا نیست؛ دست نزنید مگر طرح جدید دارید (DECISIONS).

---

## ۱۰) نقشهٔ ریسک و بدهی فنی

| مورد | وضعیت |
|---|---|
| `phase-changed/` + `PHASE-CHANGES.txt` | ساب‌ست تحویل فازها — جزو repo نگه داشته شده برای تاریخچه؛ در tsconfig exclude است؛ **برای کار روزانه نادیده‌شان بگیرید** |
| `.qa/` | شواهد E2E (اسکرین‌شات‌ها) — قابل حذف، هیچ تستی به آن وابسته نیست (فیکسچرها در `public/qa/` جدا هستند) |
| دو خروجی وب (Next/Vite) | عمدی: Next برای SSR وب، Vite باندل دسکتاپ — تفاوت‌ها در `next.config.ts`/`vite.config.ts` |
| `worklog.md` ریشه | لاگ توسعهٔ داخلی — برای انتشار عمومی لازم نیست |

---

## ۱۱) چک‌لیست PR (استاندارد این پروژه)

- [ ] `tsc --noEmit` پاک
- [ ] `vitest run` همه سبز (تست جدید برای قابلیت جدید الزامی)
- [ ] lint فایل‌های تغییریافته پاک
- [ ] متن UI فقط از i18n (fa+en)
- [ ] تغییر مدل داده؟ → مهاجرت + تست مهاجرت + بامپ schemaVersion در ProjectFile
- [ ] تغییر شیء/فرمان/پنل؟ → از رجیستری، بدون dispatch ساختاری
- [ ] تغییر رسانه؟ → هر دو twin (وب/دسکتاپ) را در نظر بگیرید + شبیه‌ساز
- [ ] ورودی user-facing جدید؟ → رفتار فارسی/RTL/ارقام فارسی
- [ ] CHANGELOG.md + (در صورت تصمیم معماری) DECISIONS.md به‌روز
