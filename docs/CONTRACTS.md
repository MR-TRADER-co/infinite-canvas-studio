# Data Hub Contracts (فاز ۱۰ — R10.2)

این سند قراردادهای دادهٔ مرکز داده (Data Hub) را تعریف می‌کند: هر قرارداد یک
شناسه، یک نسخهٔ semver و مجموعه‌ای از روش‌های پرس‌وجو دارد. ارائه‌دهنده
(`provider`) قرارداد را ثبت می‌کند؛ مصرف‌کننده (`consumer`) با اعلام بازهٔ
نسخهٔ قابل‌قبول پرس‌وجو می‌کند و در صورت ناسازگاری، مرکز داده پیام
«در دسترس نیست» فارسی برمی‌گرداند و مصرف‌کننده **با وقار** خاموش می‌شود
(پیام + خاموشیِ ویژگی، بدون هیچ کرش — AC10.1).

## قواعد مشترک

- **نسخه‌گذاری**: نسخهٔ ارائه‌دهنده باید بازهٔ مصرف‌کننده را ارضا کند.
  بازه‌های پشتیبانی‌شده: `*`، `^X.Y.Z`، `~X.Y.Z`، `>=X`، دقیق.
- **قابلیت دسترس‌پذیری فقط از افزونه‌های فعال**: با غیرفعال‌شدن/حذفِ
  افزونهٔ ارائه‌دهنده، قرارداد فوراً «بدون ارائه‌دهنده» می‌شود.
- **رویداد تغییر (`publish`)**: ارائه‌دهنده فقط در قراردادِ خودش می‌تواند
  تغییر اعلام کند؛ payload تغییر دارای فیلد `type` است
  (مثل `task-completed` — فیلترِ موتور اتوماسیون).
- **مجوز**: هر دو سمتِ ارائه و مصرف، مجوز `datahub` می‌خواهند.
- **خطاها**: نتیجهٔ پرس‌وجو همیشه `{ok, result}` یا
  `{ok: false, reason, message}` است — `message` فارسی و آمادهٔ نمایش.

---

## calendar.events — v1.0.0

**ارائه‌دهنده**: افزونهٔ «تقویم» (first-party، R10.3) — مجوز: `storage`.

دامنهٔ داده: **سراسری** (ذخیرهٔ اختصاصی افزونه) — تصمیم در DECISIONS.md.

| روش | پارامترها | نتیجه |
|-----|-----------|-------|
| `getEvents` | `{from?: {jy,jm,jd}, to?: {jy,jm,jd}}` | `{events: [{id, title, jy, jm, jd, time?, color?}]}` |
| `addEvent` | `{title, date: {jy,jm,jd}, time?, color?}` | `{event}` — رویداد change با `type: "event-added"` |
| `updateEvent` | `{id, patch: {title?, date?, time?, color?}}` | `{ok, event}` — `type: "event-updated"` |
| `deleteEvent` | `{id}` | `{ok}` — `type: "event-deleted"` |
| `monthInfo` | `{jy, jm}` | `{year, month, monthName, length, firstWeekday, holidays: [{day, title}], events: [{day, title, color, id}]}` |
| `toJalali` | `{gy, gm, gd}` | `{jy, jm, jd}` (الگوریتم دقیق jalaali-js) |
| `toGregorian` | `{jy, jm, jd}` | `{gy, gm, gd}` |
| `getHolidays` | `{jy, jm}` | `{holidays: [{day, title}]}` |

تعطیلی‌ها: تاریخ‌های شمسی دقیق + تعطیلی‌های قمری به‌صورت جدول تقریبی
برای سال‌های ۱۴۰۳ تا ۱۴۰۵ (در KNOWN_LIMITATIONS ثبت شده). تعطیلی‌های
قمری با پسوند «(تقریبی)» نمایش داده می‌شوند.

## planner.tasks — v1.0.0

**ارائه‌دهنده**: افزونهٔ «برنامه‌ریز» (first-party، R10.4) — مجوزها:
`storage` + `projectRead` + `projectWrite` + `datahub`.

دامنهٔ داده: **به‌ازای پروژه** (بخش `plugins.planner` فایل پروژه) با
«نمای کلی» سراسری (آینهٔ همهٔ پروژه‌های دیده‌شده در همین مرورگر —
DECISIONS.md).

| روش | پارامترها | نتیجه |
|-----|-----------|-------|
| `getState` | `{}` | `{projectId, goals: [{id, title, kind: "long"\|"short", createdAt}], tasks: [{id, title, goalId?, status: "pending"\|"done", due?: {jy,jm,jd}, createdAt, completedAt}]}` |
| `addGoal` | `{title, kind}` | `{goal}` — `type: "goal-added"` |
| `updateGoal` / `deleteGoal` | `{id, patch?}` | `{ok}` — `type: "goal-updated"/"goal-deleted"` |
| `addTask` | `{title, goalId?, due?}` | `{task}` — `type: "task-added"` |
| `updateTask` | `{id, patch}` | `{ok}` — `type: "task-updated"` |
| `completeTask` | `{id}` | `{task}` — `type: "task-completed"` (ماشهٔ قانون نمونهٔ AC10.4) |
| `reopenTask` | `{id}` | `{ok}` — `type: "task-updated"` |
| `deleteTask` | `{id}` | `{ok}` — `type: "task-deleted"` |
| `queryTasks` | `{status?, goalId?, overdue?}` | `{tasks, today: {jy,jm,jd}}` |

## project.digest — v1.0.0

**ارائه‌دهنده**: خودِ برنامه (`host`، R10.2) — بدون مجوز افزونه؛ خواندنش
فقط مجوز `datahub` می‌خواهد.

| روش | پارامترها | نتیجه |
|-----|-----------|-------|
| `get` | `{}` | خلاصهٔ کامل (پایین) |
| `changed` | `{}` | `{changed: true}` (کنترل سلامت) |

payload کامل `get`:

```json
{
  "generatedAt": "ISO",
  "meta": {"projectName": "…", "savedPath": "…|null", "dirty": false, "lastSavedAt": "…|null"},
  "counts": {"objects": 0, "frames": 0, "bookmarks": 0, "byKind": {"sticky": 0}},
  "texts": [{"kind": "sticky|textbox|table", "name": "…|null", "excerpt": "≤120 chars"}],
  "activity": {"historyDepth": 0, "canUndo": false, "canRedo": false}
}
```

رویداد تغییر: `type: "project-changed"` پس از هر `scene:changed` و
`persistence:saved`. `texts` حداکثر ۱۶ شیءِ متنی با ۱۲۰ نویسهٔ خالص
(HTML پاک‌شده) — «مصالح روزنامه‌نگاری» تحلیلگر هوش.

## انتشار از سوی افزونه‌ها
## dailynotes.entries — v1.0.0

**ارائه‌دهنده**: افزونهٔ «یادداشت روزانه» (`dailynotes`، pack-14 R14.2).
مصرف‌کننده‌های فعلی: تحلیلگر هوش (ژورنال ساخت‌یافته)، گزارش‌گیر
(نمودار واژه/روند) و موتور اتوماسیون (تریگر `entry-created`).

| روش | پارامترها | نتیجه |
|-----|-----------|-------|
| `getEntries` | `{from?: "YYYY-MM-DD", to?: "YYYY-MM-DD"}` | `{entries: […]}` (پایین) |

هر entry:

```json
{
  "dateISO": "YYYY-MM-DD",
  "objectId": "obj-…",
  "title": "۲۴ مرداد ۱۴۰۵ — پنجشنبه",
  "wordCount": 42,
  "properties": {"type": "daily", "date": "…", "mood": 3},
  "backlinkCount": 1
}
```

یادداشت‌ها **اشیاء متنی واقعی** صحنه‌اند (نه دادهٔ افزونه)؛ افزونه فقط
سازنده و زنجیره‌ساز است — با غیرفعال‌شدنش یادداشت‌ها می‌مانند و پیوندهای
مالکش حذف می‌شوند (AC14.6). رویداد تغییر: `type: "entry-created"` با
`{dateISO, objectId, title, wordCount}` پس از هر ساخت موفق.



```
app.datahub.provide({contractId, version, methods, query(method, params)})
app.datahub.query({contractId, versionRange, method, params})
app.datahub.subscribe({contractId, versionRange?}, listener)
app.datahub.publish({contractId, change})
```

محدودیت‌ها: مهلت پاسخ ارائه‌دهنده ۴ ثانیه است (پس از آن `provider-error`
با پیام فارسی)؛ شناسهٔ قرارداد باید با `[a-z][a-z0-9.-]*` سازگار باشد؛
`publish` فقط برای قراردادِ خودِ افزونه مجاز است.

## نشانگر «امروز» در پارامترهای قانون‌ها

در اکشن‌های datahubِ قانون‌های خودکار، هر مقدار پارامتر برابر با رشتهٔ
`"__today__"` هنگام **شلیک** (نه ذخیره) به تاریخ جلالیِ روز جاری
تبدیل می‌شود — بازگشتی در کل ساختار (شیء/آرایه). قانونِ ذخیره‌شده مارکر را
نگه می‌دارد تا هر روز درست بماند؛ قاعدهٔ نمونهٔ پنل اتوماسیون
(`task-completed → calendar.events.addEvent`) دقیقاً همین نشانگر را
برای `date` می‌گذارد تا رویداد روی روزِ تکمیل کار بیفتد.
