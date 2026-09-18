# PLUGINS — راهنمای نویسندهٔ افزونه (فاز ۹ و ۱۰)

این سند قرارداد کاملِ نوشتن افزونه برای Infinite Canvas Studio است: قالب
بسته، مجوزها، سطح SDK (به تفکیک نسخه)، مرکز داده، بسته‌بندی و محدودیت‌های
sandbox. مثال زندهٔ هر مفهوم در `public/plugins-sample/sticky-shape-pack`
(نمونهٔ رسمی) و چهار افزونهٔ اول‌شخصِ
`public/plugins-firstparty/{calendar,planner,reporter,ai-analyst}`
(فاز ۱۰) موجود است.

## ۱) قالب بسته

```
<pluginId>/
  manifest.json    # اجباری
  entry.js         # اجباری — تابع سراسری pluginMain(app)
  i18n/fa.json     # اختیاری — ادغام خودکار زیر mementoٔ افزونه
  i18n/en.json
  icon.svg         # اختیاری
```

`manifest.json`:

```json
{
  "id": "my-plugin",
  "name": "نام افزونه",
  "version": "1.0.0",
  "sdkRange": "^1.0.0",
  "permissions": ["storage"],
  "dependencies": [],
  "entry": "entry.js",
  "icon": "icon.svg",
  "description": "…"
}
```

اعتبارسنجی هنگام نصب (همهٔ خطاها فارسی — R9.1): `id` یکتا و بدون پیشوند
رزروشدهٔ `core.`؛ `version`/`sdkRange` معتبر semver؛ مجوزها فقط از مجموعهٔ
شناخته‌شده؛ وابستگی‌ها باید نصب باشند. نصب از زیپ (≤۸MB)، از پوشه (فقط
دسکتاپ) یا از افزونه‌های داخلی خود برنامه.

## ۲) مجوزها

| مجوز | یعنی چه |
|------|---------|
| `storage` | ذخیره‌سازی اختصاصی (KV + جدول‌های SQL کوچک زیر پیشوند افزونه) |
| `network` | درخواست‌های http(s) بیرونی — هستهٔ برنامه آفلاین می‌ماند |
| `projectRead` | خواندن بخش اختصاصی افزونه در فایل پروژه |
| `projectWrite` | نوشتن همان بخش |
| `datahub` | ثبت/مصرف قراردادهای مرکز داده (فاز ۱۰) |
| `scene` | ساخت اشیاء واقعی روی بوم (یادداشت متن، قاب چینش خودکار)، ثبت پیوندِ بین‌شیءِ متعلق به افزونه و پرواز دوربین — سطح کنترل‌شدهٔ `app.scene` (pack ۱۴) |

رضایت: دیالوگ نصب همهٔ مجوزها را با متن سادهٔ فارسی فهرست می‌کند؛ نصب
فقط با پذیرش کامل انجام می‌شود. در زمان اجرا، پلِ پشت هر فراخوانی SDK
مجوز را بررسی می‌کند (fail-closed، خطای تایپ‌دار).

## ۳) قرارداد اجرا (entry.js)

```js
function pluginMain(app) { /* … */ }
```

- **حالت headless** (sandbox اصلی): فقط ثبت‌ها (objects/commands/panels/
  settings/داده) انجام می‌شود.
- **حالت region** (`app.region` تعریف شده): بدنهٔ پنل یا بخش تنظیمات با
  DOM خودِ iframe رندر می‌شود. `app.region.id` با `panel:…` یا
  `settings:…` شروع می‌شود.

بوت‌استرِپ مرورگر پس از دست‌دادن (`hello` → `ready`)، سورس را با
`new Function("app", …)` اجرا و `pluginMain(app)` را صدا می‌زند. خطای
ایجاد → رویداد `plugin.crashed` → نمایش در مدیر افزونه‌ها؛ برنامه سالم
می‌ماند (AC9.3).

## ۴) سطح SDK v1

```js
app.commands.register({id, titleKey, icon?, shortcut?, execute})
app.commands.execute(commandId)
app.objects.register({id, titleKey, group?, order?, icon?, preview?,
                      width?, height?, factory(point), renderWidget?(data, size)})
app.objects.create / get / list / update / remove
app.selection.ids() / .on(listener)
app.panels.register({id, titleKey, icon?, placement, order?})
app.settings.register({id, titleKey, order?})
app.storage.get/set/delete/sql
app.events.on(appEvent, listener)   // فقط رویدادهای مجاز
app.project.read()/write(data)       // فقط بخش خودِ افزونه
app.i18n.merge({fa, en})
app.network.fetch(url, {method, headers, body})  // مجوز network
app.datahub.provide/query/subscribe/publish      // فاز ۱۰ — مجوز datahub
app.region.post(message) / .onMessage(listener) // فقط داخل region
```

قواعد امنیتی مهم:

- **تابع از پل عبور نمی‌کند**: `factory`/`renderWidget`/`query`/
  `execute` سمت افزونه می‌مانند؛ فقط فیلدهای سریال‌پذیر عبور می‌کنند.
- **کارت‌های کاتالوگ فقط از فراداده رندر می‌شوند** (AC9.10): پنل درج هرگز
  افزونه را صدا نمی‌زند؛ عنوان‌ها از i18nِ بسته رفع می‌شوند.
- مهلت کارخانهٔ شیء ۲ ثانیه و مهلت پرس‌وجوی مرکز داده ۴ ثانیه است؛
  شکست → توست فارسی، بدون شیء ناقص.

## ۵) مرکز داده (فاز ۱۰)

کامل‌ترین مرجع: `docs/CONTRACTS.md`. خلاصه:

```js
// ارائه (فقط sandbox اصلی)
app.datahub.provide({
  contractId: "my.data", version: "1.0.0",
  methods: ["get", "put"],
  query: function (method, params) { /* فقط نتیجه عبور می‌کند */ }
});
// مصرف (هر sandbox — headless یا region)
var outcome = await app.datahub.query({
  contractId: "calendar.events", versionRange: "^1",
  method: "monthInfo", params: {jy: 1403, jm: 5}
});
if (!outcome.ok) { /* outcome.message فارسی → پیام و خاموشیِ با وقار */ }
// اعلام تغییر (فقط ارائه‌دهندهٔ همان قرارداد)
app.datahub.publish({contractId: "my.data", change: {type: "updated"}});
// اشتراک
await app.datahub.subscribe({contractId: "my.data", versionRange: "^1"}, onChange);
```

## ۶) i18n

کلیدهای بسته زیر مالکیت افزونه ادغام می‌شوند: `pluginId:key`. ثبت‌ها
`titleKey` کامل می‌خواهند (`"calendar:panel.title"`). هسته هرگز سایه‌ور
نمی‌شود؛ ادغام مجدد = جای‌گزینی. تغییر زبان با رویداد `ui:language-changed`
به افزونه می‌رسد.

## ۷) بسته‌بندی و توزیع

زیپ (ریشه یا یک پوشهٔ ریشه‌ای)، حداکثر ۸ مگابایت. هر ورودی باید آفلاین
کار کند؛ دارایی‌ها با URL نسبیِ بسته. افزونه‌های اول‌شخص همین قرارداد را
دارند و از همان دیالوگ رضایت نصب می‌شوند — سگ‌شکمِ SDK همین است که آن‌ها
را اثبات می‌کند (فاز ۱۰).

## ۸) محدودیت‌های sandbox

- iframe با `sandbox="allow-scripts"` (بدون allow-same-origin): مبدا opaque؛
  بدون دسترسی به DOM برنامه، localStorage برنامه یا Tauri.
- شبکه فقط از طریق `app.network.fetch` (فقط http/https؛ متد از مجموعهٔ
  GET/POST/PUT/PATCH/DELETE؛ بدنه ≤ ۵۱۲KB).
- هر پیام پل با شمافور `v:1` اعتبارسنجی و به iframe همان افزونه پین
  می‌شود.

## ۹) فروشگاه افزونه‌ها (فاز ۲۲)

«فروشگاه افزونه‌ها» یک کاتالوگ غنی روی همان خط لولهٔ نصب است — نه یک
مسیر دوم. پنل افزونه‌ها دکمهٔ «فروشگاه» و حالت خالی CTA «مرور فروشگاه»
را دارد؛ دیالوگ (پورتال به `document.body`، RTL کامل):

- **جستجو** با نرمال‌سازی فارسی (ZWNJ، ی/ک عربی، حرکات) روی نام +
  توضیح + شناسه؛
- **دسته‌های سرپرستی‌شده**: بهره‌وری · تحلیل و گزارش · تقویم و دانش ·
  نمونه و آموزش (+ «همه»)؛
- **بنر «انتخاب سردبیر»** (یادداشت روزانه) و گرید کارت‌ها با آیکون،
  نسخه، توضیح دوطرفه و شمار مجوزها با ارقام فارسی؛
- **وضعیت زندهٔ هر کارت**: «نصب» → مرحلهٔ رضایت (فهرست دقیق مجوزها
  پیش از پذیرش — همان AC9.4) → «در حال اجرا» / «غیرفعال» با کلید
  فعال/غیرفعال و تأیید دوگزینه‌ای حذف؛ همه با رویداد
  `plugins:changed` زنده می‌ماند.

منطق کاتالوگ در `src/plugins/host/pluginCatalog.ts` خالص و تست‌شده
است؛ فرادادهٔ سرپرستی‌شده (دسته‌ها، انتخاب سردبیر) در کد زندگی
می‌کند و مانیفست‌های افزونه‌ها دست‌نخورده مانده‌اند.
