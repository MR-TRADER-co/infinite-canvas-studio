# استودیو بوم بی‌نهایت — Infinite Canvas Studio

**بوم بی‌نهایتِ کاملاً آفلاین با پشتیبانی درجه‌یک از فارسی و راست‌به‌چپ (RTL).**
نسخهٔ ۱٫۴۸٫۵ · ۲٬۴۵۱ تست خودکار، همه سبز

یک اپلیکیشن «وایت‌برد بی‌نهایت» که کلأ در مرورگر یا روی دسکتاپ ویندوز اجرا می‌شود — بدون سرور، بدون حساب کاربری، بدون اینترنت. متن غنی و جدول‌های فارسی، رسانه (تصویر/ویدئو/صوت/PDF)، لایهٔ دانش ویکی‌مانند، افزونه‌ها و حالت ارائه — همه در یک فایل پروژهٔ قابل حمل `.icb`.

## قابلیت‌های کلیدی

- 🎨 **بوم بی‌نهایت**: شکل، خط قلم/هایلایتر، یادداشت چسبان، متن غنی، جدول، اتصال، استیکر (۲۰۰+)، قاب، گروه، لایه‌ها، نام‌گذاری
- ✍️ **فارسی‌محور**: رابط RTL، ارقام فارسی، نیم‌فاصله، تاریخ شمسی، قلم وزیرمتن، جهت per-block، جدول‌های راست‌به‌چپ — و شکل‌دهی صحیح فارسی در همهٔ خروجی‌ها
- 🧱 **متن غنی (TipTap)**: سرتیترها، فهرست‌ها، فهرست کارها، نقل‌قول، کد، پیوند، هایلایت، قلم‌نگار، جستجو/جایگزینی
- 🎬 **رسانه**: درج تصویر/ویدئو/صوت/PDF با کشیدن‌ورها یا دیالوگ؛ تبدیل آفلاین قالب‌ها با ffmpeg.wasm؛ پخش‌کننده‌های شناور؛ **نمایشگر PDF با انتخاب و کپی متن فارسی**
- 🧠 **لایهٔ دانش**: پیوند ویکی `[[...]]`، برچسب `#...`، ویژگی‌های ساخت‌یافته، کوئری‌های زنده، گراف دانش با چینش خودکار
- 💾 **پروژهٔ قابل حمل `.icb`**: ذخیرهٔ خودکار + بازیابی، نسخه‌های زمان‌دار، مهاجرت خودکار از نسخه‌های قدیمی، فایل‌های اخیر، پوشهٔ رسانهٔ sidecar
- 📤 **پنج خروجی**: PNG (انتخاب/کل، شفاف) · SVG · PDF چاپ (قاب‌به‌قاب) · **Word با جدول واقعی** · Markdown (+ پوشهٔ آینه) — به‌علاوه کپی HTML غنی به Word/چت‌های AI
- 🧩 **افزونه‌ها**: فروشگاه افزونه‌های داخلی (تقویم، برنامه‌ریز، گزارش‌گر، تحلیلگر هوش، یادداشت روزانه) + نصب ZIP با سندباکس امن و مجوزهای شفاف + اتوماسیون «وقتی… آنگاه…»
- 🖥 **دو پوسته، یک کد**: وب (Next.js 16) و دسکتاپ ویندوز (Tauri 2 + NSIS installer) — همهٔ قابلیت‌ها از جمله رسانه در exe کار می‌کنند

## مستندات

| سند | برای چه کسی؟ |
|---|---|
| [`docs/USER_GUIDE.md`](./docs/USER_GUIDE.md) | **راهنمای کامل کاربر** — همهٔ کارها و قابلیت‌های UI، قدم‌به‌قدم + جدول میان‌برها |
| [`docs/FEATURES.md`](./docs/FEATURES.md) | شرح پروژه و فهرست کامل ویژگی‌ها (با وضعیت تست) |
| [`docs/TECHNICAL_MAP.md`](./docs/TECHNICAL_MAP.md) | **نقشهٔ فنی دقیق برای توسعه‌دهندگان** — معماری، جریان داده، «برای تغییر X به کدام فایل»، رجیستری‌ها، تله‌ها |
| [`docs/SEAMS.md`](./docs/SEAMS.md) | نقاط توسعه و قرارداد رجیستری‌ها |
| [`docs/PLUGINS.md`](./docs/PLUGINS.md) | نویسندگی افزونه (manifest، SDK، مجوزها) |
| [`docs/KNOWN_LIMITATIONS.md`](./docs/KNOWN_LIMITATIONS.md) | محدودیت‌های شناخته‌شده |

## اجرای سریع (نسخهٔ وب)

```bash
npm install     # فقط بار اول
npm run dev     # → http://localhost:3000
```

## ساخت exe ویندوز

پیش‌نیاز: **Node.js 18+** · **Rust** (rustup.rs) · **VS Build Tools** (C++)

```bash
npm install
npm run tauri:build
# نصب‌کننده: src-tauri/target/release/bundle/nsis/Infinite Canvas Studio_1.48.5_x64-setup.exe
# exe مستقل: src-tauri/target/release/infinite-canvas-studio.exe
```

> بار اولِ کامپایل Rust ۵ تا ۲۰ دقیقه طول می‌کشد — طبیعی است.
> دابل‌کلیک روی فایل `.icb` در ویندوز، برنامه را با همان پروژه باز می‌کند.

## دستورهای مفید

| دستور | کار |
|---|---|
| `npm run dev` | نسخهٔ وب روی :3000 |
| `npm run tauri:dev` | پنجرهٔ دسکتاپ با hot-reload |
| `npm run tauri:build` | ساخت exe/installer |
| `npm run test` | ۲٬۴۵۱ تست (Vitest) |
| `npm run typecheck` / `npm run lint` | کنترل کیفیت |

## ساختار پوشه‌ها

```
├─ src/
│  ├─ core/        موتور خالص: مدل صحنه (۱۹ نوع شیء)، هندسه، فرمان‌ها،
│  │                تاریخچه، رجیستری‌ها، رویدادها، دانش، جستجو
│  ├─ interaction/  ابزارها (Select/Pen/Shape/Table/Connector…) + قیف فرمان
│  ├─ rendering/    رندر Canvas2D + اوورلی‌ها
│  ├─ text/         ویرایشگر غنی TipTap (فارسی + جدول + паст)
│  ├─ media/        pdf.js، ffmpeg.wasm، پوستر/موج، قیف قالب‌ها
│  ├─ persistence/  .icb + مهاجرت‌ها + AssetStore (وب/دسکتاپ) + ۵ خروجی
│  ├─ plugins/      اجراپیمای افزونه (سندباکس + مجوز + SDK)
│  ├─ ui/           React: پنل‌ها، پنجره‌های شناور، i18n فارسی/انگلیسی
│  ├─ app/          پوستهٔ Next.js (وب)
│  └─ main.tsx      پوستهٔ Vite/Tauri (دسکتاپ)
├─ src-tauri/       پوستهٔ Rust + پروتکل رسانهٔ icbasset://
├─ public/         pdfjs، ffmpeg.wasm، قالب‌ها، افزونه‌های داخلی، فیکسچر تست
└─ tests/           ۲۱۸ فایل تست — آینهٔ ساختار src
```

جزئیات کامل هر پوشه و «برای تغییر هر ویژگی به کجا بروید»: [`docs/TECHNICAL_MAP.md`](./docs/TECHNICAL_MAP.md)

## مشارکت (Contribution)

1. از `main` یک branch بزنید؛ 2. `npm run typecheck && npm run test` سبز؛ 3. برای متن UI فقط از دیکشنری `fa.ts`/`en.ts`؛ 4. قابلیت جدید = تست جدید؛ 5. تغییر مدل داده = مهاجرت + بامپ نسخهٔ schema. چک‌لیست کامل در انتهای `docs/TECHNICAL_MAP.md`.

## اعتبارها و مجوزها

**لایسنس پروژه: [MIT](./LICENSE)** — کد این پروژه آزادانه قابل استفاده، تغییر و توزیع است؛ به‌شرط حفظ اعلان کپی‌رایت. کتابخانه‌ها و رسانه‌های همراه، لایسنس مخصوص خودشان را دارند:

- **سازنده:** [MR-TRADER-co](https://github.com/MR-TRADER-co) — مخزن رسمی: [github.com/MR-TRADER-co/infinite-canvas-studio](https://github.com/MR-TRADER-co/infinite-canvas-studio)
- موتورها و کتابخانه‌ها: Next.js، React، TipTap (ProseMirror)، Tailwind، Radix UI، pdf.js (Apache-2.0)، ffmpeg.wasm (LGPL/GPL — جزئیات در [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md))
- فونت: Vazirmatn (OFL)

### English Quick Start

```bash
npm install
npm run dev          # web on http://localhost:3000
npm run tauri:build  # Windows desktop installer + portable exe
```

Fully offline infinite-canvas studio with first-class Persian/RTL support — rich text, tables, media (image/video/audio/PDF with a text-selectable floating viewer), a knowledge layer (wiki links, tags, live queries, graph), a sandboxed plugin runtime, and five export formats (PNG/SVG/PDF/Word/Markdown). One shared codebase, two shells: Next.js web + Tauri 2 desktop. Project code is MIT-licensed — see [LICENSE](./LICENSE). Built by [MR-TRADER-co](https://github.com/MR-TRADER-co) — [github.com/MR-TRADER-co/infinite-canvas-studio](https://github.com/MR-TRADER-co/infinite-canvas-studio).
