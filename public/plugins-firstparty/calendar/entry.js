/**
 * Calendar — the first-party calendar plugin (R10.3).
 *
 * Provides the `calendar.events` v1 datahub contract:
 *   getEvents / addEvent / updateEvent / deleteEvent / monthInfo /
 *   toJalali / toGregorian / getHolidays
 * + a month-grid canvas widget (catalog card in the Insert Panel),
 * + the «تقویم» panel (month navigation + event CRUD, Jalali default
 *   with a Gregorian toggle),
 * + a settings section (default calendar type + event colour).
 *
 * Data scope: GLOBAL (plugin storage), decision logged in DECISIONS.md.
 * Iranian holidays: solar dates exact + lunar dates bundled as a
 * per-year approximation table (documented limitation).
 *
 * Headless mode (no app.region): contract + registrations.
 * Region mode: renders the panel body or the settings section.
 */

/* eslint-disable */
var LANG = "fa";
var DICT = {
  fa: {
    group: "تقویم",
    panelTitle: "تقویم",
    today: "امروز",
    prev: "ماه قبل",
    next: "ماه بعد",
    addEvent: "افزودن رویداد",
    eventTitle: "عنوان رویداد",
    time: "ساعت (اختیاری)",
    color: "رنگ",
    save: "ذخیره",
    delete: "حذف",
    noEvents: "رویدادی در این روز نیست.",
    jalali: "جلالی",
    gregorian: "میلادی",
    calendarType: "نوع تقویم",
    defaultColor: "رنگ پیش‌فرض رویدادها",
    defaultColorDesc: "رنگ نقطه‌ها و برچسب رویدادهای تازه.",
    holiday: "تعطیل رسمی",
    eventsOn: "رویداد در این ماه",
    saved: "ذخیره شد.",
    deleteConfirm: "این رویداد حذف شود؟"
  },
  en: {
    group: "Calendar",
    panelTitle: "Calendar",
    today: "Today",
    prev: "Previous month",
    next: "Next month",
    addEvent: "Add event",
    eventTitle: "Event title",
    time: "Time (optional)",
    color: "Colour",
    save: "Save",
    delete: "Delete",
    noEvents: "No events on this day.",
    jalali: "Jalali",
    gregorian: "Gregorian",
    calendarType: "Calendar type",
    defaultColor: "Default event colour",
    defaultColorDesc: "Colour of dots and labels for new events.",
    holiday: "Official holiday",
    eventsOn: "events this month",
    saved: "Saved.",
    deleteConfirm: "Delete this event?"
  }
};
function T(key) {
  return (DICT[LANG] && DICT[LANG][key]) || (DICT.fa[key] || key);
}

/* ---- Jalali <-> Gregorian (self-contained jalaali-js algorithm) ---- */
var BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060,
  2097, 2192, 2262, 2324, 2394, 2456, 3178
];
function div(a, b) { return Math.trunc(a / b); }
function mod(a, b) { return a - div(a, b) * b; }
function jalCal(jy) {
  var bl = BREAKS.length, gy = jy + 621, leapJ = -14;
  var jp = BREAKS[0], jm = BREAKS[1], jump = jm - jp;
  for (var i = 1; i < bl; i += 1) {
    jm = BREAKS[i]; jump = jm - jp;
    if (jy < jm) { break; }
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  var n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) { leapJ += 1; }
  var leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  var march = 20 + leapJ - leapG;
  if (jump - n < 6) { n = n - jump + div(jump + 4, 33) * 33; }
  var leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) { leap = 4; }
  return { leap: leap, gy: gy, march: march };
}
function g2d(gy, gm, gd) {
  var d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
function d2g(jdn) {
  var j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  var i = div(mod(j, 1461), 4) * 5 + 308;
  var gd = div(mod(i, 153), 5) + 1;
  var gm = mod(div(i, 153), 12) + 1;
  var gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy: gy, gm: gm, gd: gd };
}
function d2j(jdn) {
  var gy = d2g(jdn).gy, jy = gy - 621;
  var r = jalCal(jy);
  var jdn1f = g2d(gy, 3, r.march), k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 186) { return { jy: jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 }; }
    k -= 186;
    return { jy: jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
  }
  jy -= 1; k += 179;
  if (r.leap === 1) { k += 1; }
  return { jy: jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}
function j2d(jy, jm, jd) {
  var r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}
function toJalali(gy, gm, gd) { return d2j(g2d(gy, gm, gd)); }
function toGregorian(jy, jm, jd) { return d2g(j2d(jy, jm, jd)); }
function isLeapJalali(jy) { return jalCal(jy).leap === 0; }
function jalaliMonthLength(jy, jm) {
  if (jm <= 6) { return 31; }
  if (jm <= 11) { return 30; }
  return isLeapJalali(jy) ? 30 : 29;
}

/* ---- Iranian holidays (bundled offline dataset) ----
 * Solar dates are exact (fixed every year). Lunar dates are bundled as
 * a per-year approximation table covering 1403–1407 (docs/CONTRACTS.md). */
var SOLAR_HOLIDAYS = [
  { m: 1, d: 1, t: "نوروز" },
  { m: 1, d: 2, t: "عید نوروز" },
  { m: 1, d: 3, t: "عید نوروز" },
  { m: 1, d: 4, t: "عید نوروز" },
  { m: 1, d: 12, t: "روز جمهوری اسلامی" },
  { m: 1, d: 13, t: "سیزده‌بدر" },
  { m: 2, d: 14, t: "رحلت امام خمینی" },
  { m: 2, d: 15, t: "قیام ۱۵ خرداد" },
  { m: 11, d: 22, t: "پیروزی انقلاب اسلامی" },
  { m: 12, d: 29, t: "ملی شدن صنعت نفت" }
];
var LUNAR_HOLIDAYS = {
  1403: [
    { m: 1, d: 21, t: "عید فطر" }, { m: 1, d: 22, t: "عید فطر" },
    { m: 4, d: 3, t: "عید قربان (تقریبی)" },
    { m: 4, d: 10, t: "عید غدیر (تقریبی)" },
    { m: 4, d: 14, t: "رحلت پیامبر (تقریبی)" },
    { m: 4, d: 25, t: "تاسوعا (تقریبی)" }, { m: 4, d: 26, t: "عاشورا (تقریبی)" },
    { m: 6, d: 3, t: "اربعین (تقریبی)" },
    { m: 6, d: 29, t: "ولادت پیامبر (تقریبی)" },
    { m: 11, d: 23, t: "ولادت امام علی (تقریبی)" },
    { m: 12, d: 7, t: "مبعث (تقریبی)" },
    { m: 12, d: 22, t: "ولادت امام زمان (تقریبی)" }
  ],
  1404: [
    { m: 1, d: 10, t: "عید فطر (تقریبی)" }, { m: 1, d: 11, t: "عید فطر (تقریبی)" },
    { m: 3, d: 23, t: "عید قربان (تقریبی)" },
    { m: 3, d: 30, t: "عید غدیر (تقریبی)" },
    { m: 5, d: 4, t: "رحلت پیامبر (تقریبی)" },
    { m: 5, d: 15, t: "تاسوعا (تقریبی)" }, { m: 5, d: 16, t: "عاشورا (تقریبی)" },
    { m: 6, d: 23, t: "اربعین (تقریبی)" },
    { m: 7, d: 19, t: "ولادت پیامبر (تقریبی)" },
    { m: 11, d: 3, t: "ولادت امام علی (تقریبی)" },
    { m: 12, d: 17, t: "مبعث (تقریبی)" },
    { m: 12, d: 30, t: "ولادت امام زمان (تقریبی)" }
  ],
  1405: [
    { m: 1, d: 19, t: "عید فطر (تقریبی)" }, { m: 1, d: 20, t: "عید فطر (تقریبی)" },
    { m: 4, d: 2, t: "عید قربان (تقریبی)" },
    { m: 4, d: 9, t: "عید غدیر (تقریبی)" },
    { m: 5, d: 23, t: "رحلت پیامبر (تقریبی)" },
    { m: 5, d: 5, t: "تاسوعا (تقریبی)" }, { m: 5, d: 6, t: "عاشورا (تقریبی)" },
    { m: 6, d: 12, t: "اربعین (تقریبی)" },
    { m: 6, d: 8, t: "ولادت پیامبر (تقریبی)" },
    { m: 10, d: 14, t: "ولادت امام علی (تقریبی)" },
    { m: 12, d: 6, t: "مبعث (تقریبی)" },
    { m: 12, d: 19, t: "ولادت امام زمان (تقریبی)" }
  ]
};
var JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"
];
var GREGORIAN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function holidaysOf(jy, jm) {
  var list = [];
  for (var i = 0; i < SOLAR_HOLIDAYS.length; i += 1) {
    if (SOLAR_HOLIDAYS[i].m === jm) {
      list.push({ day: SOLAR_HOLIDAYS[i].d, title: SOLAR_HOLIDAYS[i].t });
    }
  }
  var lunar = LUNAR_HOLIDAYS[jy] || [];
  for (var k = 0; k < lunar.length; k += 1) {
    if (lunar[k].m === jm) {
      list.push({ day: lunar[k].d, title: lunar[k].t });
    }
  }
  return list;
}

/* ---- storage helpers (KV over app.storage) ---- */
var EVENTS_KEY = "events";
var SETTINGS_KEY = "settings";
var DEFAULT_COLOR = "#38bdf8";
var DEFAULT_SETTINGS = { calendarType: "jalali", defaultColor: DEFAULT_COLOR };

function readEvents(app) {
  return app.storage.get(EVENTS_KEY).then(function (value) {
    return Array.isArray(value) ? value : [];
  });
}
function writeEvents(app, events) {
  return app.storage.set(EVENTS_KEY, events);
}
function readSettings(app) {
  return app.storage.get(SETTINGS_KEY).then(function (value) {
    if (value && typeof value === "object") {
      return {
        calendarType: value.calendarType === "gregorian" ? "gregorian" : "jalali",
        defaultColor:
          typeof value.defaultColor === "string" && value.defaultColor
            ? value.defaultColor
            : DEFAULT_COLOR
      };
    }
    return { calendarType: "jalali", defaultColor: DEFAULT_COLOR };
  });
}

function sameDate(a, b) {
  return a && b && a.jy === b.jy && a.jm === b.jm && a.jd === b.jd;
}

/** The contract's query handler (persists through the plugin storage). */
function contractQuery(method, params) {
  /* `this` is bound to {app: app}; params carry the request. */
  var app = this.app;
  var p = params || {};
  switch (method) {
    case "getEvents": {
      return readEvents(app).then(function (events) {
        var from = p.from || null, to = p.to || null;
        return {
          events: events.filter(function (event) {
            if (from && (event.jy < from.jy ||
                (event.jy === from.jy && event.jm < from.jm) ||
                (event.jy === from.jy && event.jm === from.jm && event.jd < from.jd))) {
              return false;
            }
            if (to && (event.jy > to.jy ||
                (event.jy === to.jy && event.jm > to.jm) ||
                (event.jy === to.jy && event.jm === to.jm && event.jd > to.jd))) {
              return false;
            }
            return true;
          })
        };
      });
    }
    case "addEvent": {
      if (!p || !p.title || typeof p.title !== "string" || !p.date) {
        throw new Error("عنوان و تاریخ رویداد لازم است.");
      }
      return readSettings(app).then(function (settings) {
        return readEvents(app).then(function (events) {
          var event = {
            id: "evt:" + Date.now() + ":" + Math.floor(Math.random() * 1e6),
            title: p.title,
            jy: p.date.jy, jm: p.date.jm, jd: p.date.jd,
            time: typeof p.time === "string" ? p.time : null,
            color: typeof p.color === "string" && p.color
              ? p.color
              : settings.defaultColor
          };
          events.push(event);
          return writeEvents(app, events).then(function () {
            publishChange(app, { type: "event-added", event: event });
            return { event: event };
          });
        });
      });
    }
    case "updateEvent": {
      if (!p || !p.id) { throw new Error("شناسهٔ رویداد لازم است."); }
      return readEvents(app).then(function (events) {
        var found = null;
        for (var i = 0; i < events.length; i += 1) {
          if (events[i].id === p.id) {
            if (p.patch && p.patch.title) { events[i].title = String(p.patch.title); }
            if (p.patch && p.patch.date) {
              events[i].jy = p.patch.date.jy;
              events[i].jm = p.patch.date.jm;
              events[i].jd = p.patch.date.jd;
            }
            if (p.patch && typeof p.patch.time === "string") { events[i].time = p.patch.time; }
            if (p.patch && typeof p.patch.color === "string") { events[i].color = p.patch.color; }
            found = events[i];
            break;
          }
        }
        return writeEvents(app, events).then(function () {
          if (found) { publishChange(app, { type: "event-updated", event: found }); }
          return { ok: found !== null, event: found };
        });
      });
    }
    case "deleteEvent": {
      if (!p || !p.id) { throw new Error("شناسهٔ رویداد لازم است."); }
      return readEvents(app).then(function (events) {
        var removed = null;
        var kept = events.filter(function (event) {
          if (event.id === p.id) { removed = event; return false; }
          return true;
        });
        return writeEvents(app, kept).then(function () {
          if (removed) { publishChange(app, { type: "event-deleted", event: removed }); }
          return { ok: removed !== null };
        });
      });
    }
    case "monthInfo": {
      var jy = p.jy, jm = p.jm;
      if (typeof jy !== "number" || typeof jm !== "number") {
        throw new Error("سال و ماه جلالی لازم است.");
      }
      return readEvents(app).then(function (events) {
        var monthEvents = events
          .filter(function (event) { return event.jy === jy && event.jm === jm; })
          .map(function (event) {
            return { day: event.jd, title: event.title, color: event.color, id: event.id };
          });
        return {
          year: jy,
          month: jm,
          monthName: JALALI_MONTHS[jm - 1],
          length: jalaliMonthLength(jy, jm),
          firstWeekday: weekdayOfJalali(jy, jm, 1),
          holidays: holidaysOf(jy, jm),
          events: monthEvents
        };
      });
    }
    case "toJalali": {
      return toJalali(p.gy, p.gm, p.gd);
    }
    case "toGregorian": {
      return toGregorian(p.jy, p.jm, p.jd);
    }
    case "getHolidays": {
      return { holidays: holidaysOf(p.jy, p.jm) };
    }
    default:
      throw new Error("روش ناشناخته: " + method);
  }
}

/** weekday (0=شنبه … 6=جمعه) of a Jalali date. */
function weekdayOfJalali(jy, jm, jd) {
  var g = toGregorian(jy, jm, jd);
  var js = new Date(Date.UTC(g.gy, g.gm - 1, g.gd));
  var dow = js.getUTCDay(); // 0=Sunday … 6=Saturday
  return (dow + 1) % 7; // 0=Saturday … 6=Friday
}

function publishChange(app, change) {
  app.datahub
    .publish({ contractId: "calendar.events", change: change })
    .catch(function () { /* the hub degrades on its own */ });
}

/* ---- widget snapshot (pure HTML, rendered by the host in inert
 *     iframes — AC9.10: no plugin code runs for the catalog cards) ---- */
function monthGridHtml(data) {
  var jy = data.jy, jm = data.jm;
  var today = data.today || null;
  var events = data.events || [];
  var holidays = data.holidays || [];
  var length = jalaliMonthLength(jy, jm);
  var first = weekdayOfJalali(jy, jm, 1);
  var headers = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
  var cells = "";
  for (var blank = 0; blank < first; blank += 1) {
    cells += '<div></div>';
  }
  for (var day = 1; day <= length; day += 1) {
    var isToday = today && today.jy === jy && today.jm === jm && today.jd === day;
    var holiday = null;
    for (var h = 0; h < holidays.length; h += 1) {
      if (holidays[h].day === day) { holiday = holidays[h]; break; }
    }
    var dots = "";
    for (var e = 0; e < events.length; e += 1) {
      if (events[e].day === day) {
        dots +=
          '<span style="display:inline-block;width:4px;height:4px;border-radius:50%;' +
          'margin:0 1px;background:' + (events[e].color || DEFAULT_COLOR) + '"></span>';
      }
    }
    cells +=
      '<div style="aspect-ratio:1;display:flex;flex-direction:column;align-items:center;' +
      "justify-content:center;border-radius:6px;font-size:10px;position:relative;" +
      (isToday
        ? "background:rgba(56,189,248,.25);border:1px solid rgba(56,189,248,.6);font-weight:700;"
        : holiday
          ? "color:#f87171;"
          : "") +
      '">' + day + '<span style="height:6px">' + dots + "</span></div>";
  }
  return (
    '<div dir="rtl" style="width:100%;height:100%;padding:10px;box-sizing:border-box;' +
    'background:rgba(15,23,42,.55);border-radius:12px;color:#e7e5e4;' +
    'font:11px/1.6 system-ui,sans-serif;display:flex;flex-direction:column;gap:6px;">' +
    '<div style="display:flex;justify-content:space-between;font-weight:700;font-size:12px;">' +
    "<span>" + (JALALI_MONTHS[jm - 1] || "") + " " + jy + "</span>" +
    '<span style="opacity:.7;font-size:10px">' + events.length + " " + "رویداد</span></div>" +
    '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;opacity:.6;font-size:9px;">' +
    headers.map(function (h) { return "<div>" + h + "</div>"; }).join("") +
    "</div>" +
    '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;flex:1;">' +
    cells + "</div></div>"
  );
}

function pluginMain(app) {
  if (app.region) {
    renderRegion(app);
    app.events.on("ui:language-changed", function (payload) {
      LANG = payload && payload.language === "en" ? "en" : "fa";
      renderRegion(app);
    });
    return;
  }

  /* ---- headless: the contract + contributions ---- */
  app.datahub.provide({
    contractId: "calendar.events",
    version: "1.0.0",
    methods: [
      "getEvents", "addEvent", "updateEvent", "deleteEvent",
      "monthInfo", "toJalali", "toGregorian", "getHolidays"
    ],
    query: function (method, params) {
      return contractQuery.call({ app: app }, method, params);
    }
  });

  app.objects.register({
    id: "monthGrid",
    titleKey: "calendar:monthGrid.title",
    group: "calendar:group",
    order: 20,
    icon: "CalendarDays",
    preview: "🗓",
    width: 320,
    height: 300,
    factory: function () {
      var now = toJalali(
        new Date().getFullYear(),
        new Date().getMonth() + 1,
        new Date().getDate()
      );
      return readEvents(app).then(function (events) {
        return {
          jy: now.jy,
          jm: now.jm,
          today: { jy: now.jy, jm: now.jm, jd: now.jd },
          events: events
            .filter(function (event) { return event.jy === now.jy && event.jm === now.jm; })
            .map(function (event) { return { day: event.jd, title: event.title, color: event.color }; }),
          holidays: holidaysOf(now.jy, now.jm)
        };
      });
    },
    renderWidget: function (data) {
      return monthGridHtml(data || {});
    }
  });

  app.commands.register({
    id: "insertMonthGrid",
    titleKey: "calendar:command.insertMonthGrid",
    icon: "CalendarDays",
    execute: function () {
      app.objects.create("monthGrid");
    }
  });

  app.panels.register({
    id: "main",
    titleKey: "calendar:panel.title",
    icon: "CalendarDays",
    placement: "right",
    order: 300
  });

  app.settings.register({
    id: "preferences",
    titleKey: "calendar:settings.title",
    order: 300
  });
}

/* ---- region rendering (the plugin's own iframe DOM) ---- */

var regionState = {
  mode: "jalali",
  jy: null, jm: null,
  selected: null,
  editing: null
};

function renderRegion(app) {
  var regionId = app.region.id;
  var isSettings = regionId.indexOf("settings:") === 0;
  document.body.innerHTML = "";
  document.body.dir = LANG === "en" ? "ltr" : "rtl";
  document.body.style.cssText =
    "margin:0;padding:10px;font:12px/1.7 system-ui,sans-serif;" +
    "color:#e7e5e4;background:transparent;";

  if (isSettings) {
    renderSettingsRegion(app);
  } else {
    renderPanelRegion(app);
  }
}

function renderSettingsRegion(app) {
  var title = document.createElement("p");
  title.textContent = T("calendarType");
  title.style.cssText = "margin:0 0 6px;font-weight:600;";
  document.body.appendChild(title);

  var typeRow = document.createElement("div");
  typeRow.style.cssText = "display:flex;gap:6px;margin-bottom:10px;";
  ["jalali", "gregorian"].forEach(function (type) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = T(type);
    button.style.cssText =
      "flex:1;padding:6px 8px;border-radius:8px;cursor:pointer;font:inherit;" +
      "border:1px solid rgba(148,163,184,.35);color:#e7e5e4;background:rgba(15,23,42,.55);";
    button.addEventListener("click", function () {
      readSettings(app).then(function (settings) {
        settings.calendarType = type;
        return app.storage.set(SETTINGS_KEY, settings);
      });
      renderSettingsRegion(app);
    });
    typeRow.appendChild(button);
  });
  document.body.appendChild(typeRow);

  var colourLabel = document.createElement("p");
  colourLabel.textContent = T("defaultColor");
  colourLabel.style.cssText = "margin:0 0 2px;font-weight:600;";
  document.body.appendChild(colourLabel);
  var desc = document.createElement("p");
  desc.textContent = T("defaultColorDesc");
  desc.style.cssText = "margin:0 0 6px;opacity:.7;font-size:10px;";
  document.body.appendChild(desc);
  var colour = document.createElement("input");
  colour.type = "color";
  colour.value = DEFAULT_COLOR;
  document.body.appendChild(colour);
  readSettings(app).then(function (settings) {
    colour.value = settings.defaultColor;
  });
  var saved = document.createElement("span");
  saved.style.cssText = "opacity:0;transition:opacity .3s;color:#34d399;font-size:10px;";
  colour.addEventListener("change", function () {
    readSettings(app).then(function (settings) {
      settings.defaultColor = colour.value;
      return app.storage.set(SETTINGS_KEY, settings);
    }).then(function () {
      saved.textContent = T("saved");
      saved.style.opacity = "1";
      setTimeout(function () { saved.style.opacity = "0"; }, 1500);
    });
  });
  document.body.appendChild(saved);
}

function renderPanelRegion(app) {
  var today = toJalali(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    new Date().getDate()
  );
  if (regionState.jy === null) {
    regionState.jy = today.jy;
    regionState.jm = today.jm;
    regionState.mode = "jalali";
  }

  readSettings(app).then(function (settings) {
    if (regionState.mode === null) { regionState.mode = settings.calendarType; }
    readEvents(app).then(function (events) {
      drawPanel(app, today, events);
    });
  });
}

function drawPanel(app, today, events) {
  document.body.innerHTML = "";
  var container = document.createElement("div");
  container.style.cssText = "display:flex;flex-direction:column;gap:8px;";

  /* header: month navigation + mode toggle */
  var header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:4px;";
  var prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = "→";
  prev.style.cssText = BUTTON_STYLE;
  prev.title = T("prev");
  var label = document.createElement("span");
  label.style.cssText = "flex:1;text-align:center;font-weight:700;";
  var next = document.createElement("button");
  next.type = "button";
  next.textContent = "←";
  next.style.cssText = BUTTON_STYLE;
  next.title = T("next");

  var monthTitle;
  if (regionState.mode === "jalali") {
    monthTitle = (JALALI_MONTHS[regionState.jm - 1] || "") + " " + regionState.jy;
  } else {
    var g = toGregorian(regionState.jy, regionState.jm, 1);
    monthTitle = GREGORIAN_MONTHS[g.gm - 1] + " " + g.gy;
  }
  label.textContent = monthTitle;

  prev.addEventListener("click", function () { shiftMonth(-1); renderPanelRegion(app); });
  next.addEventListener("click", function () { shiftMonth(1); renderPanelRegion(app); });
  header.appendChild(prev);
  header.appendChild(label);
  header.appendChild(next);
  container.appendChild(header);

  /* mode toggle + today */
  var controls = document.createElement("div");
  controls.style.cssText = "display:flex;gap:4px;";
  var jalaliButton = document.createElement("button");
  jalaliButton.type = "button";
  jalaliButton.textContent = T("jalali");
  jalaliButton.style.cssText = BUTTON_STYLE + "flex:1;";
  var gregorianButton = document.createElement("button");
  gregorianButton.type = "button";
  gregorianButton.textContent = T("gregorian");
  gregorianButton.style.cssText = BUTTON_STYLE + "flex:1;";
  var todayButton = document.createElement("button");
  todayButton.type = "button";
  todayButton.textContent = T("today");
  todayButton.style.cssText = BUTTON_STYLE + "flex:1;";
  jalaliButton.addEventListener("click", function () {
    regionState.mode = "jalali";
    renderPanelRegion(app);
  });
  gregorianButton.addEventListener("click", function () {
    regionState.mode = "gregorian";
    renderPanelRegion(app);
  });
  todayButton.addEventListener("click", function () {
    regionState.jy = today.jy;
    regionState.jm = today.jm;
    regionState.selected = { jy: today.jy, jm: today.jm, jd: today.jd };
    renderPanelRegion(app);
  });
  controls.appendChild(jalaliButton);
  controls.appendChild(gregorianButton);
  controls.appendChild(todayButton);
  container.appendChild(controls);

  /* the month grid */
  var grid = document.createElement("div");
  grid.style.cssText =
    "display:grid;grid-template-columns:repeat(7,1fr);gap:2px;direction:rtl;";
  ["ش", "ی", "د", "س", "چ", "پ", "ج"].forEach(function (h) {
    var head = document.createElement("div");
    head.textContent = h;
    head.style.cssText =
      "text-align:center;font-size:9px;opacity:.6;";
    grid.appendChild(head);
  });

  var monthLength = jalaliMonthLength(regionState.jy, regionState.jm);
  var firstWeekday = weekdayOfJalali(regionState.jy, regionState.jm, 1);
  var holidays = holidaysOf(regionState.jy, regionState.jm);
  for (var blank = 0; blank < firstWeekday; blank += 1) {
    grid.appendChild(document.createElement("div"));
  }
  var _loopDay = function (day) {
    var cell = document.createElement("div");
    var isToday =
      today.jy === regionState.jy && today.jm === regionState.jm && today.jd === day;
    var isSelected =
      regionState.selected &&
      regionState.selected.jy === regionState.jy &&
      regionState.selected.jm === regionState.jm &&
      regionState.selected.jd === day;
    var holidayTitle = null;
    holidays.forEach(function (holiday) {
      if (holiday.day === day) { holidayTitle = holiday.title; }
    });
    var dayEvents = events.filter(function (event) {
      return event.jy === regionState.jy && event.jm === regionState.jm && event.jd === day;
    });
    cell.textContent = String(day);
    cell.style.cssText =
      "aspect-ratio:1.15;display:flex;align-items:center;justify-content:center;" +
      "border-radius:6px;cursor:pointer;font-size:11px;position:relative;" +
      (isToday ? "font-weight:700;" : "") +
      (holidayTitle ? "color:#f87171;" : "") +
      (isSelected ? "background:rgba(56,189,248,.3);" : "background:rgba(15,23,42,.5);");
    if (dayEvents.length > 0) {
      var dot = document.createElement("span");
      dot.style.cssText =
        "position:absolute;bottom:2px;width:4px;height:4px;border-radius:50%;" +
        "background:" + (dayEvents[0].color || DEFAULT_COLOR) + ";";
      cell.appendChild(dot);
    }
    cell.addEventListener("click", function () {
      regionState.selected = { jy: regionState.jy, jm: regionState.jm, jd: day };
      renderPanelRegion(app);
    });
    if (holidayTitle) { cell.title = holidayTitle; }
    grid.appendChild(cell);
  };
  for (var day = 1; day <= monthLength; day += 1) {
    _loopDay(day);
  }
  container.appendChild(grid);

  /* the selected day's events + add form */
  var dayBox = document.createElement("div");
  dayBox.style.cssText =
    "border-top:1px solid rgba(148,163,184,.25);padding-top:8px;";
  var dayTitle = document.createElement("p");
  dayTitle.style.cssText = "margin:0 0 4px;font-weight:600;";
  var selected = regionState.selected || { jy: today.jy, jm: today.jm, jd: today.jd };
  dayTitle.textContent =
    (JALALI_MONTHS[selected.jm - 1] || "") + " " + selected.jd + " — " +
    selected.jy;
  dayBox.appendChild(dayTitle);

  var dayEvents = events.filter(function (event) {
    return event.jy === selected.jy && event.jm === selected.jm && event.jd === selected.jd;
  });
  if (dayEvents.length === 0) {
    var none = document.createElement("p");
    none.textContent = T("noEvents");
    none.style.cssText = "margin:0 0 6px;opacity:.6;font-size:11px;";
    dayBox.appendChild(none);
  } else {
    dayEvents.forEach(function (event) {
      var row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;gap:6px;margin-bottom:4px;" +
        "background:rgba(15,23,42,.5);border-radius:8px;padding:4px 8px;";
      var swatch = document.createElement("span");
      swatch.style.cssText =
        "width:8px;height:8px;border-radius:50%;flex-shrink:0;background:" +
        (event.color || DEFAULT_COLOR) + ";";
      var text = document.createElement("span");
      text.style.cssText = "flex:1;font-size:11px;";
      text.textContent = (event.time ? event.time + " · " : "") + event.title;
      var del = document.createElement("button");
      del.type = "button";
      del.textContent = "🗑";
      del.style.cssText =
        "background:none;border:none;cursor:pointer;color:#f87171;";
      del.addEventListener("click", function () {
        if (window.confirm(T("deleteConfirm"))) {
          app.storage.set(EVENTS_KEY, events.filter(function (other) {
            return other.id !== event.id;
          })).then(function () {
            publishChange(app, { type: "event-deleted", event: event });
            renderPanelRegion(app);
          });
        }
      });
      row.appendChild(swatch);
      row.appendChild(text);
      row.appendChild(del);
      dayBox.appendChild(row);
    });
  }

  /* add-event form */
  var form = document.createElement("div");
  form.style.cssText =
    "display:flex;flex-direction:column;gap:4px;margin-top:6px;";
  var titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = T("eventTitle");
  titleInput.style.cssText = INPUT_STYLE;
  var timeInput = document.createElement("input");
  timeInput.type = "text";
  timeInput.placeholder = T("time");
  timeInput.style.cssText = INPUT_STYLE;
  var colourInput = document.createElement("input");
  colourInput.type = "color";
  colourInput.value = DEFAULT_COLOR;
  colourInput.style.cssText = "width:100%;height:26px;border:none;background:none;";
  var addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = T("addEvent");
  addButton.style.cssText =
    "padding:6px;border-radius:8px;cursor:pointer;font:inherit;" +
    "border:1px solid rgba(56,189,248,.4);background:rgba(56,189,248,.2);color:#e7e5e4;";
  addButton.addEventListener("click", function () {
    var title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }
    var payload = {
      title: title,
      date: { jy: selected.jy, jm: selected.jm, jd: selected.jd },
      time: timeInput.value.trim() || null,
      color: colourInput.value
    };
    /* Route through the CONTRACT so automations + consumers see it. */
    app.datahub
      .query({
        contractId: "calendar.events",
        versionRange: "^1",
        method: "addEvent",
        params: payload
      })
      .then(function () { renderPanelRegion(app); })
      .catch(function () { renderPanelRegion(app); });
  });
  form.appendChild(titleInput);
  form.appendChild(timeInput);
  form.appendChild(colourInput);
  form.appendChild(addButton);
  dayBox.appendChild(form);
  container.appendChild(dayBox);

  document.body.appendChild(container);
}

function shiftMonth(delta) {
  var jm = regionState.jm + delta;
  var jy = regionState.jy;
  if (jm > 12) { jm = 1; jy += 1; }
  if (jm < 1) { jm = 12; jy -= 1; }
  regionState.jm = jm;
  regionState.jy = jy;
}

var BUTTON_STYLE =
  "padding:4px 8px;border-radius:8px;cursor:pointer;font:inherit;" +
  "border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.55);color:#e7e5e4;";
var INPUT_STYLE =
  "padding:5px 8px;border-radius:8px;font:inherit;color:#e7e5e4;" +
  "border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.55);outline:none;";
