/**
 * Daily Notes — the first-party daily-journal plugin (pack-14 R14.1).
 *
 * The journal loop, closed: one command (Ctrl+Alt+D) creates today's
 * note as a REAL text object inside the «یادداشت‌های روزانه»
 * auto-layout column frame (created on first use), titles it with the
 * JALALI date bought from the `calendar.events` contract — degrading
 * GRACEFULLY to a Gregorian title + a Persian notice when the calendar
 * plugin is off (the hub's showcase degrade pattern) — chains every
 * daily to the next through the LinkRegistry (kind "plugin", owner
 * "dailynotes"), flies the camera and publishes `entry-created`.
 *
 * Provides the `dailynotes.entries` v1 contract (R14.2):
 *   getEntries(range) → {dateISO, objectId, title, wordCount,
 *   properties, backlinkCount}[] — the structured journal source the
 *   AI Analyst and Reporter consume; `onEntryCreated` rides the hub's
 *   change channel (publish), which the automations engine watches.
 *
 * Surfaces: 5 commands (today/yesterday/tomorrow + prev/next), the
 * «یادداشت روزانه» dock panel, a settings section (the note template
 * with {{date}}/{{dateFa}}/{{weekday}}/{{cursor}} placeholders).
 *
 * Headless mode (no app.region): commands + contract + chain upkeep.
 * Region mode: renders the panel body or the settings section.
 */

/* eslint-disable */
var LANG = "fa";
var DICT = {
  fa: {
    panelTitle: "یادداشت روزانه",
    today: "امروز",
    yesterday: "دیروز",
    tomorrow: "فردا",
    prev: "قبلی",
    next: "بعدی",
    todayExists: "یادداشت امروز از قبل هست — دوربین روی آن نشست.",
    created: "یادداشت ساخته شد و در قاب «یادداشت‌های روزانه» نشست.",
    degradeNotice:
      "افزونهٔ تقویم فعال نیست؛ عنوان به میلادی نوشته شد (تنزل نرم، نه خطا).",
    noPrev: "یادداشت قبلی‌تری نیست.",
    noNext: "یادداشت بعدی‌تری نیست.",
    noDailies: "هنوز یادداشتی نیست — با «امروز» شروع کنید.",
    listTitle: "دفترچه",
    words: "واژه",
    chainLabel: "روز بعد",
    headerToday: "امروز",
    calendarOn: "تقویم جلالی فعال",
    calendarOff: "بدون تقویم — عنوان میلادی",
    templateTitle: "قالب یادداشت",
    templateDesc:
      "جای‌نگهدارها: {{date}} تاریخ میلادی، {{dateFa}} تاریخ جلالی، {{weekday}} روز هفته، {{cursor}} محل شروع نوشتن.",
    templateSave: "ذخیرهٔ قالب",
    templateReset: "بازنشانی",
    templateSaved: "قالب یادداشت ذخیره شد.",
    templateHint: "خط اول عنوانِ یادداشت می‌شود و پیوندها بر همان خط کار می‌کنند.",
    noteWidth: "پهنای یادداشت (واحد بوم)",
    settingsSaved: "تنظیمات ذخیره شد.",
    frameTitle: "یادداشت‌های روزانه",
    openNote: "نمایش"
  },
  en: {
    panelTitle: "Daily Notes",
    today: "Today",
    yesterday: "Yesterday",
    tomorrow: "Tomorrow",
    prev: "Previous",
    next: "Next",
    todayExists: "Today's note already exists — the camera is on it.",
    created: "The note was created inside the Dailies frame.",
    degradeNotice:
      "The calendar plugin is off; the title fell back to Gregorian (a graceful degrade, not an error).",
    noPrev: "There is no earlier note.",
    noNext: "There is no later note.",
    noDailies: "No notes yet — start with Today.",
    listTitle: "Journal",
    words: "words",
    chainLabel: "next day",
    headerToday: "Today",
    calendarOn: "Jalali calendar active",
    calendarOff: "No calendar — Gregorian titles",
    templateTitle: "Note template",
    templateDesc:
      "Placeholders: {{date}} Gregorian date, {{dateFa}} Jalali date, {{weekday}} weekday, {{cursor}} where typing starts.",
    templateSave: "Save template",
    templateReset: "Reset",
    templateSaved: "The note template was saved.",
    templateHint: "The first line becomes the note's title; links bind on that line.",
    noteWidth: "Note width (canvas units)",
    settingsSaved: "Settings saved.",
    frameTitle: "Dailies",
    openNote: "Open"
  }
};
function T(key) {
  return (DICT[LANG] && DICT[LANG][key]) || (DICT.fa[key] || key);
}

/* ---- constants ---- */
var SETTINGS_KEY = "settings";
var DEFAULT_TEMPLATE = "{{dateFa}} — {{weekday}}\n\n{{cursor}}";
var DEFAULT_NOTE_WIDTH = 340;
var NOTE_FONT_SIZE = 16;
var FRAME_WIDTH = 380;
var FRAME_GAP = 16;
var FRAME_PAD = 16;
var FRAME_TITLE_HEIGHT = 28;
var NOTE_ESTIMATE = 110;
var ISO_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var MONTHS_FA = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"
];
var WEEKDAYS_FA = [
  "شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"
];
var WEEKDAYS_EN = [
  "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"
];

/* ---- small helpers ---- */
function pad2(n) { return n < 10 ? "0" + n : String(n); }
function toFaDigits(text) {
  return String(text).replace(/[0-9]/g, function (d) {
    return "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d));
  });
}
function countWords(text) {
  var t = typeof text === "string" ? text.trim() : "";
  if (t === "") { return 0; }
  return t.split(/\s+/).filter(Boolean).length;
}
function firstLine(text) {
  var t = typeof text === "string" ? text : "";
  var nl = t.indexOf("\n");
  return (nl === -1 ? t : t.slice(0, nl)).trim();
}

/* ---- date resolution ---- */
function dateForOffset(offsetDays) {
  var d = new Date();
  d.setDate(d.getDate() + offsetDays);
  var weekdayIdx = (d.getDay() + 1) % 7;
  return {
    gy: d.getFullYear(),
    gm: d.getMonth() + 1,
    gd: d.getDate(),
    iso: d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()),
    weekdayIdx: weekdayIdx
  };
}
function weekdayName(day) {
  return LANG === "en"
    ? WEEKDAYS_EN[day.weekdayIdx] || ""
    : WEEKDAYS_FA[day.weekdayIdx] || "";
}
/** Buys the Jalali conversion through the calendar.events contract. */
function jalaliOf(app, day) {
  return app.datahub
    .query({
      contractId: "calendar.events",
      versionRange: "^1",
      method: "toJalali",
      params: { gy: day.gy, gm: day.gm, gd: day.gd }
    })
    .then(function (outcome) {
      if (outcome && outcome.ok && outcome.result &&
          typeof outcome.result.jy === "number") {
        return outcome.result;
      }
      return null;
    })
    .catch(function () { return null; });
}
function formatFaDate(j) {
  return toFaDigits(j.jd) + " " + (MONTHS_FA[j.jm - 1] || "") + " " + toFaDigits(j.jy);
}
/**
 * Resolves one day: the ISO key + the display pieces for titles and
 * templates. `jalali === null` marks the GRACEFUL degrade (Gregorian).
 */
function resolveDay(app, offsetDays) {
  var day = dateForOffset(offsetDays);
  return jalaliOf(app, day).then(function (jalali) {
    var weekday = weekdayName(day);
    if (jalali !== null) {
      return {
        iso: day.iso,
        weekday: weekday,
        jalali: jalali,
        dateFa: formatFaDate(jalali),
        degraded: false
      };
    }
    return {
      iso: day.iso,
      weekday: weekday,
      jalali: null,
      dateFa: day.iso,
      degraded: true
    };
  });
}

/* ---- settings ---- */
function readSettings(app) {
  return app.storage.get(SETTINGS_KEY).then(function (value) {
    if (value && typeof value === "object") {
      return {
        template:
          typeof value.template === "string" && value.template.trim() !== ""
            ? value.template
            : DEFAULT_TEMPLATE,
        noteWidth:
          typeof value.noteWidth === "number" &&
          Number.isFinite(value.noteWidth) &&
          value.noteWidth >= 120 &&
          value.noteWidth <= 1200
            ? value.noteWidth
            : DEFAULT_NOTE_WIDTH
      };
    }
    return { template: DEFAULT_TEMPLATE, noteWidth: DEFAULT_NOTE_WIDTH };
  });
}

/* ---- dailies scanning ---- */
function isDailyRecord(object) {
  return Boolean(
    object &&
    object.properties &&
    object.properties.type === "daily" &&
    typeof object.properties.date === "string" &&
    ISO_PATTERN.test(object.properties.date)
  );
}
function toDailyRecord(object) {
  var text = typeof object.text === "string" ? object.text : "";
  return {
    id: object.id,
    dateISO: object.properties.date,
    title: firstLine(text) || object.properties.date,
    wordCount: countWords(text),
    properties: object.properties || {},
    position: object.position || { x: 0, y: 0 },
    width: typeof object.width === "number" ? object.width : DEFAULT_NOTE_WIDTH,
    height: typeof object.height === "number" ? object.height : NOTE_ESTIMATE
  };
}
function listDailies(app) {
  return app.objects.list().then(function (objects) {
    return (objects || [])
      .filter(isDailyRecord)
      .map(toDailyRecord)
      .sort(function (a, b) { return a.dateISO < b.dateISO ? -1 : 1; });
  });
}

/* ---- the Dailies frame ---- */
function findDailiesFrame(objects) {
  for (var i = 0; i < (objects || []).length; i += 1) {
    var o = objects[i];
    if (
      o &&
      o.kind === "frame" &&
      o.properties &&
      o.properties.dailiesFrame === true
    ) {
      return o;
    }
  }
  return null;
}
/**
 * Finds (or creates on first use) the auto-layout column frame. The
 * marker property `dailiesFrame: true` survives renames and moves.
 */
function ensureFrame(app, dailies) {
  return app.objects.list().then(function (objects) {
    var existing = findDailiesFrame(objects);
    if (existing !== null) {
      return existing;
    }
    var stackHeight = 0;
    for (var i = 0; i < dailies.length; i += 1) {
      stackHeight += Math.max(NOTE_ESTIMATE, dailies[i].height) + FRAME_GAP;
    }
    var height = Math.max(
      560,
      FRAME_TITLE_HEIGHT + 2 * FRAME_PAD + stackHeight + NOTE_ESTIMATE + FRAME_GAP
    );
    return app.scene
      .insertFrame({
        title: T("frameTitle"),
        width: FRAME_WIDTH,
        height: height,
        layout: {
          dir: "column",
          gap: FRAME_GAP,
          padding: FRAME_PAD,
          itemWidth: "fill"
        },
        props: { dailiesFrame: true }
      })
      .then(function (result) {
        if (result === null) { return null; }
        return app.objects.get(result.objectId).then(function (frame) {
          return frame || null;
        });
      });
  });
}
/** The world CENTRE for the note's slot (append at the stack bottom). */
function slotCentreFor(frame, dailies) {
  var stackHeight = 0;
  for (var i = 0; i < dailies.length; i += 1) {
    stackHeight += Math.max(NOTE_ESTIMATE, dailies[i].height) + FRAME_GAP;
  }
  var top =
    frame.position.y + FRAME_TITLE_HEIGHT + FRAME_PAD + stackHeight;
  var noteWidth = frame.width - 2 * FRAME_PAD;
  return {
    x: frame.position.x + frame.width / 2,
    y: top + NOTE_ESTIMATE / 2,
    width: Math.max(120, noteWidth)
  };
}

/* ---- template ---- */
function expandTemplate(template, day) {
  var weekday = day.weekday;
  return String(template)
    .replace(/\{\{dateFa\}\}/g, day.dateFa)
    .replace(/\{\{date\}\}/g, day.iso)
    .replace(/\{\{weekday\}\}/g, weekday)
    .replace(/\{\{cursor\}\}/g, "")
    .replace(/\r/g, "");
}

/* ---- the chain (prev/next links, kind "plugin") ---- */
/**
 * Keeps the forward chain exact: consecutive dailies linked
 * (a → b, label «روز بعد»), no stale pairs. When the set drifted
 * (a note deleted, dates changed) the whole owner-owned chain is
 * rebuilt atomically: remove-by-owner + re-add every desired pair.
 */
function reconcileChain(app, dailies) {
  return app.scene.listLinks({ ownerId: "dailynotes" }).then(function (links) {
    var desired = {};
    for (var i = 0; i + 1 < dailies.length; i += 1) {
      desired[dailies[i].id + "->" + dailies[i + 1].id] = {
        sourceId: dailies[i].id,
        targetId: dailies[i + 1].id
      };
    }
    var existing = {};
    for (var k = 0; k < (links || []).length; k += 1) {
      existing[links[k].sourceId + "->" + links[k].targetId] = links[k];
    }
    var stale = Object.keys(existing).filter(function (key) {
      return !desired[key];
    });
    var sequence = Promise.resolve();
    if (stale.length > 0) {
      sequence = sequence
        .then(function () { return app.scene.removeLinksByOwner(); })
        .then(function () {
          return Object.keys(desired).map(function (key) {
            return app.scene
              .addLink({
                sourceId: desired[key].sourceId,
                targetId: desired[key].targetId,
                label: T("chainLabel")
              })
              .catch(function () { return null; });
          });
        })
        .then(function (jobs) { return Promise.all(jobs); });
      return sequence;
    }
    var adds = Object.keys(desired)
      .filter(function (key) { return !existing[key]; })
      .map(function (key) {
        return app.scene
          .addLink({
            sourceId: desired[key].sourceId,
            targetId: desired[key].targetId,
            label: T("chainLabel")
          })
          .catch(function () { return null; });
      });
    return Promise.all(adds);
  });
}

/* ---- creation ---- */
function createDaily(app, offsetDays) {
  var day = null;
  var dailies = null;
  return resolveDay(app, offsetDays)
    .then(function (resolved) {
      day = resolved;
      return listDailies(app);
    })
    .then(function (list) {
      dailies = list;
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].dateISO === day.iso) {
          /* exists: fly + a calm notice, never a duplicate (AC14.1). */
          return app.scene.focusObject(list[i].id).then(function () {
            return app.scene.notifyInfo(T("todayExists"));
          });
        }
      }
      return readSettings(app)
        .then(function (settings) {
          return ensureFrame(app, dailies).then(function (frame) {
            return { settings: settings, frame: frame };
          });
        })
        .then(function (prepared) {
          var slot = { x: 0, y: 0, width: prepared.settings.noteWidth };
          if (prepared.frame !== null) {
            slot = slotCentreFor(prepared.frame, dailies);
          }
          var text = expandTemplate(prepared.settings.template, day);
          return app.scene
            .insertText({
              text: text,
              width: Math.max(120, slot.width || prepared.settings.noteWidth),
              fontSize: NOTE_FONT_SIZE,
              position: { x: slot.x, y: slot.y },
              props: { type: "daily", date: day.iso }
            })
            .then(function (created) {
              if (created === null) {
                return null;
              }
              var record = {
                id: created.objectId,
                dateISO: day.iso,
                title: firstLine(text) || day.iso,
                wordCount: countWords(text),
                position: { x: slot.x, y: slot.y },
                width: slot.width,
                height: NOTE_ESTIMATE
              };
              dailies.push(record);
              dailies.sort(function (a, b) {
                return a.dateISO < b.dateISO ? -1 : 1;
              });
              return reconcileChain(app, dailies)
                .then(function () { return record; });
            });
        })
        .then(function (record) {
          if (record === null) { return null; }
          return app.scene.focusObject(record.id).then(function () {
            return app.scene.notifyInfo(
              day.degraded ? T("degradeNotice") : T("created")
            );
          }).then(function () {
            /* R14.2: onEntryCreated — the hub fans this out to the AI
               Analyst / Reporter / the automations engine. */
            return app.datahub
              .publish({
                contractId: "dailynotes.entries",
                change: {
                  type: "entry-created",
                  dateISO: record.dateISO,
                  objectId: record.id,
                  title: record.title,
                  wordCount: record.wordCount
                }
              })
              .catch(function () { return false; });
          });
        });
    })
    .catch(function () { return null; });
}

/* ---- navigation (prev/next by date) ---- */
function navigateDaily(app, direction) {
  return listDailies(app).then(function (dailies) {
    if (dailies.length === 0) {
      return app.scene.notifyInfo(T("noDailies"));
    }
    return app.selection.ids().then(function (ids) {
      var anchor = null;
      for (var i = 0; i < dailies.length; i += 1) {
        if (ids.indexOf(dailies[i].id) !== -1) {
          anchor = dailies[i];
          break;
        }
      }
      if (anchor === null) {
        var today = dateForOffset(0).iso;
        for (var k = 0; k < dailies.length; k += 1) {
          if (dailies[k].dateISO === today) {
            anchor = dailies[k];
            break;
          }
        }
      }
      if (anchor === null) {
        anchor = dailies[dailies.length - 1];
      }
      var target = null;
      if (direction < 0) {
        for (var j = dailies.length - 1; j >= 0; j -= 1) {
          if (dailies[j].dateISO < anchor.dateISO) {
            target = dailies[j];
            break;
          }
        }
      } else {
        for (var m = 0; m < dailies.length; m += 1) {
          if (dailies[m].dateISO > anchor.dateISO) {
            target = dailies[m];
            break;
          }
        }
      }
      if (target === null) {
        return app.scene.notifyInfo(
          direction < 0 ? T("noPrev") : T("noNext")
        );
      }
      return app.scene.focusObject(target.id);
    });
  });
}

/* ---- the dailynotes.entries v1 contract (R14.2) ---- */
function serveEntries(app, params) {
  var p = params || {};
  return listDailies(app).then(function (dailies) {
    return app.scene.listLinks({}).then(function (links) {
      var backlinks = {};
      for (var i = 0; i < (links || []).length; i += 1) {
        var tid = links[i].targetId;
        if (tid) { backlinks[tid] = (backlinks[tid] || 0) + 1; }
      }
      var entries = [];
      for (var k = 0; k < dailies.length; k += 1) {
        var d = dailies[k];
        if (p.from && d.dateISO < p.from) { continue; }
        if (p.to && d.dateISO > p.to) { continue; }
        entries.push({
          dateISO: d.dateISO,
          objectId: d.id,
          title: d.title,
          wordCount: d.wordCount,
          properties: d.properties || { type: "daily", date: d.dateISO },
          backlinkCount: backlinks[d.id] || 0
        });
      }
      return { entries: entries };
    });
  });
}

/* ---- region rendering ---- */
var panelTimer = null;

function renderRegion(app) {
  var regionId = app.region ? app.region.id : "";
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

function chipStyle(on) {
  return (
    "display:inline-flex;align-items:center;gap:4px;padding:2px 8px;" +
    "border-radius:999px;font-size:10px;font-weight:600;" +
    "border:1px solid " + (on ? "rgba(45,212,191,.45)" : "rgba(250,204,21,.4)") + ";" +
    "background:" + (on ? "rgba(45,212,191,.12)" : "rgba(250,204,21,.1)") + ";" +
    "color:" + (on ? "#5eead4" : "#fde047") + ";"
  );
}
var BUTTON_STYLE =
  "padding:6px 10px;border-radius:10px;cursor:pointer;font:inherit;font-size:11px;" +
  "border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.55);color:#e7e5e4;" +
  "transition:background .15s,border-color .15s;";
var PRIMARY_STYLE =
  "width:100%;padding:8px 10px;border-radius:10px;cursor:pointer;font:inherit;" +
  "font-size:12px;font-weight:700;border:1px solid rgba(45,212,191,.5);" +
  "background:linear-gradient(135deg,rgba(45,212,191,.28),rgba(45,212,191,.14));" +
  "color:#ccfbf1;transition:filter .15s;";
var INPUT_STYLE =
  "padding:5px 8px;border-radius:8px;font:inherit;color:#e7e5e4;" +
  "border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.55);outline:none;";
var CARD_STYLE =
  "display:flex;align-items:center;gap:8px;padding:6px 9px;margin-bottom:5px;" +
  "border-radius:10px;border:1px solid rgba(148,163,184,.22);" +
  "background:rgba(15,23,42,.45);cursor:pointer;transition:border-color .15s,background .15s;";

function renderPanelRegion(app) {
  var container = document.createElement("div");
  container.setAttribute("data-dailynotes-panel", "1");

  var day = dateForOffset(0);
  resolveDay(app, 0).then(function (resolved) {
    var header = document.createElement("div");
    header.style.cssText =
      "display:flex;flex-direction:column;gap:5px;margin-bottom:10px;";
    var titleRow = document.createElement("div");
    titleRow.style.cssText =
      "display:flex;align-items:baseline;gap:6px;";
    var icon = document.createElement("span");
    icon.textContent = "🗓";
    icon.style.cssText = "font-size:15px;line-height:1;";
    var title = document.createElement("strong");
    title.style.cssText = "font-size:13px;";
    title.textContent = T("headerToday") + " — " + resolved.dateFa;
    titleRow.appendChild(icon);
    titleRow.appendChild(title);
    header.appendChild(titleRow);

    var chip = document.createElement("span");
    chip.style.cssText = chipStyle(!resolved.degraded);
    chip.textContent = resolved.degraded ? T("calendarOff") : T("calendarOn");
    header.appendChild(chip);

    if (resolved.degraded) {
      var banner = document.createElement("p");
      banner.textContent = T("degradeNotice");
      banner.style.cssText =
        "margin:0;font-size:10px;line-height:1.6;color:#fde047;" +
        "background:rgba(250,204,21,.08);border:1px solid rgba(250,204,21,.25);" +
        "border-radius:8px;padding:5px 8px;";
      header.appendChild(banner);
    }
    container.appendChild(header);

    var todayButton = document.createElement("button");
    todayButton.type = "button";
    todayButton.textContent = T("today") + "  (Ctrl+Alt+D)";
    todayButton.style.cssText = PRIMARY_STYLE;
    todayButton.addEventListener("mouseenter", function () {
      todayButton.style.filter = "brightness(1.18)";
    });
    todayButton.addEventListener("mouseleave", function () {
      todayButton.style.filter = "none";
    });
    todayButton.addEventListener("click", function () {
      void createDaily(app, 0);
    });
    container.appendChild(todayButton);

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;margin-top:6px;";
    [
      { label: T("yesterday"), offset: -1 },
      { label: T("tomorrow"), offset: 1 }
    ].forEach(function (item) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = item.label;
      b.style.cssText = "flex:1;" + BUTTON_STYLE;
      b.addEventListener("click", function () {
        void createDaily(app, item.offset);
      });
      row.appendChild(b);
    });
    container.appendChild(row);

    var navRow = document.createElement("div");
    navRow.style.cssText = "display:flex;gap:6px;margin-top:6px;";
    [
      { label: "◀ " + T("prev"), direction: -1 },
      { label: T("next") + " ▶", direction: 1 }
    ].forEach(function (item) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = item.label;
      b.style.cssText = "flex:1;" + BUTTON_STYLE;
      b.addEventListener("click", function () {
        void navigateDaily(app, item.direction);
      });
      navRow.appendChild(b);
    });
    container.appendChild(navRow);

    listDailies(app).then(function (dailies) {
      var listHeader = document.createElement("div");
      listHeader.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;" +
        "margin:12px 0 6px;color:#a8a29e;font-size:10px;font-weight:700;";
      var listTitle = document.createElement("span");
      listTitle.textContent = T("listTitle");
      var listCount = document.createElement("span");
      listCount.textContent = toFaDigits(dailies.length);
      listHeader.appendChild(listTitle);
      listHeader.appendChild(listCount);
      container.appendChild(listHeader);

      if (dailies.length === 0) {
        var empty = document.createElement("p");
        empty.textContent = T("noDailies");
        empty.style.cssText = "margin:0;opacity:.55;font-size:11px;";
        container.appendChild(empty);
      } else {
        var scroll = document.createElement("div");
        scroll.style.cssText = "max-height:240px;overflow-y:auto;";
        var recent = dailies.slice().reverse();
        recent.forEach(function (d) {
          var card = document.createElement("div");
          card.style.cssText = CARD_STYLE;
          card.addEventListener("mouseenter", function () {
            card.style.borderColor = "rgba(45,212,191,.5)";
            card.style.background = "rgba(15,23,42,.7)";
          });
          card.addEventListener("mouseleave", function () {
            card.style.borderColor = "rgba(148,163,184,.22)";
            card.style.background = "rgba(15,23,42,.45)";
          });
          var dateCol = document.createElement("div");
          dateCol.style.cssText = "flex:1;min-width:0;";
          var dateLine = document.createElement("div");
          dateLine.style.cssText =
            "font-weight:600;font-size:11px;white-space:nowrap;" +
            "overflow:hidden;text-overflow:ellipsis;";
          dateLine.textContent = d.title;
          var metaLine = document.createElement("div");
          metaLine.style.cssText = "font-size:10px;color:#a8a29e;";
          metaLine.textContent =
            toFaDigits(d.wordCount) + " " + T("words");
          dateCol.appendChild(dateLine);
          dateCol.appendChild(metaLine);
          var go = document.createElement("button");
          go.type = "button";
          go.textContent = "↗";
          go.title = T("openNote");
          go.style.cssText =
            "background:none;border:none;cursor:pointer;color:#5eead4;" +
            "font-size:13px;padding:2px 4px;";
          go.addEventListener("click", function () {
            void app.scene.focusObject(d.id);
          });
          card.appendChild(dateCol);
          card.appendChild(go);
          card.addEventListener("click", function () {
            void app.scene.focusObject(d.id);
          });
          scroll.appendChild(card);
        });
        container.appendChild(scroll);
      }

      var hint = document.createElement("p");
      hint.textContent = T("templateHint");
      hint.style.cssText =
        "margin:10px 0 0;font-size:9.5px;color:#78716c;line-height:1.6;";
      container.appendChild(hint);
    });
  });
  document.body.appendChild(container);
}

function renderSettingsRegion(app) {
  var container = document.createElement("div");
  container.setAttribute("data-dailynotes-settings", "1");

  readSettings(app).then(function (settings) {
    var title = document.createElement("p");
    title.textContent = T("templateTitle");
    title.style.cssText = "margin:0 0 6px;font-weight:700;font-size:12px;";
    container.appendChild(title);

    var area = document.createElement("textarea");
    area.value = settings.template;
    area.rows = 5;
    area.style.cssText =
      "width:100%;box-sizing:border-box;resize:vertical;font:11px/1.8 monospace;" +
      "color:#e7e5e4;border:1px solid rgba(148,163,184,.35);border-radius:10px;" +
      "background:rgba(15,23,42,.55);padding:8px;outline:none;";
    container.appendChild(area);

    var desc = document.createElement("p");
    desc.textContent = T("templateDesc");
    desc.style.cssText =
      "margin:6px 0 10px;font-size:10px;color:#a8a29e;line-height:1.7;";
    container.appendChild(desc);

    var widthRow = document.createElement("div");
    widthRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;";
    var widthLabel = document.createElement("label");
    widthLabel.textContent = T("noteWidth");
    widthLabel.style.cssText = "font-size:11px;color:#d6d3d1;flex:1;";
    var widthInput = document.createElement("input");
    widthInput.type = "number";
    widthInput.min = "120";
    widthInput.max = "1200";
    widthInput.step = "20";
    widthInput.value = String(settings.noteWidth);
    widthInput.style.cssText = "width:86px;" + INPUT_STYLE;
    widthRow.appendChild(widthLabel);
    widthRow.appendChild(widthInput);
    container.appendChild(widthRow);

    var actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:6px;";
    var save = document.createElement("button");
    save.type = "button";
    save.textContent = T("templateSave");
    save.style.cssText = "flex:1;" + PRIMARY_STYLE;
    save.addEventListener("click", function () {
      var width = Number(widthInput.value);
      app.storage
        .set(SETTINGS_KEY, {
          template: area.value || DEFAULT_TEMPLATE,
          noteWidth: Number.isFinite(width) ? Math.min(1200, Math.max(120, width)) : DEFAULT_NOTE_WIDTH
        })
        .then(function () {
          return app.scene.notifyInfo(T("templateSaved"));
        })
        .catch(function () {});
    });
    var reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = T("templateReset");
    reset.style.cssText = BUTTON_STYLE;
    reset.addEventListener("click", function () {
      area.value = DEFAULT_TEMPLATE;
      widthInput.value = String(DEFAULT_NOTE_WIDTH);
    });
    actions.appendChild(save);
    actions.appendChild(reset);
    container.appendChild(actions);
  });
  document.body.appendChild(container);
}

/* ---- boot ---- */
function pluginMain(app) {
  LANG =
    typeof document !== "undefined" &&
    document.documentElement &&
    document.documentElement.lang === "en"
      ? "en"
      : "fa";

  app.i18n
    .merge({
      fa: {
        "command.today": "یادداشت امروز را بساز / نشان بده",
        "command.yesterday": "یادداشت دیروز",
        "command.tomorrow": "یادداشت فردا",
        "command.prev": "یادداشت قبلی",
        "command.next": "یادداشت بعدی",
        "panel.title": "یادداشت روزانه",
        "settings.title": "یادداشت روزانه",
        group: "یادداشت روزانه"
      },
      en: {
        "command.today": "Create / show today's note",
        "command.yesterday": "Yesterday's note",
        "command.tomorrow": "Tomorrow's note",
        "command.prev": "Previous note",
        "command.next": "Next note",
        "panel.title": "Daily Notes",
        "settings.title": "Daily Notes",
        group: "Daily Notes"
      }
    })
    .catch(function () { return []; });

  app.commands
    .register({
      id: "today",
      titleKey: "dailynotes:command.today",
      icon: "NotebookPen",
      shortcut: "Mod-Alt-D",
      execute: function () { void createDaily(app, 0); }
    })
    .catch(function () {});
  app.commands
    .register({
      id: "yesterday",
      titleKey: "dailynotes:command.yesterday",
      icon: "CalendarMinus",
      execute: function () { void createDaily(app, -1); }
    })
    .catch(function () {});
  app.commands
    .register({
      id: "tomorrow",
      titleKey: "dailynotes:command.tomorrow",
      icon: "CalendarPlus",
      execute: function () { void createDaily(app, 1); }
    })
    .catch(function () {});
  app.commands
    .register({
      id: "prev",
      titleKey: "dailynotes:command.prev",
      icon: "ChevronRight",
      execute: function () { void navigateDaily(app, -1); }
    })
    .catch(function () {});
  app.commands
    .register({
      id: "next",
      titleKey: "dailynotes:command.next",
      icon: "ChevronLeft",
      execute: function () { void navigateDaily(app, 1); }
    })
    .catch(function () {});

  app.panels
    .register({
      id: "main",
      titleKey: "dailynotes:panel.title",
      icon: "NotebookPen",
      placement: "right",
      order: 290
    })
    .catch(function () {});

  app.settings
    .register({
      id: "preferences",
      titleKey: "dailynotes:settings.title",
      order: 290
    })
    .catch(function () {});

  app.datahub
    .provide({
      contractId: "dailynotes.entries",
      version: "1.0.0",
      methods: ["getEntries"],
      query: function (method, params) {
        if (method !== "getEntries") {
          return Promise.reject(new Error("روش ناشناخته: " + method));
        }
        return serveEntries(app, params);
      }
    })
    .catch(function () {});

  app.events
    .on("ui:language-changed", function (payload) {
      LANG = payload && payload.language === "en" ? "en" : "fa";
      if (app.region) { renderRegion(app); }
    })
    .catch(function () {});

  app.events
    .on("scene:changed", function () {
      if (panelTimer !== null) { clearTimeout(panelTimer); }
      panelTimer = setTimeout(function () {
        panelTimer = null;
        if (
          app.region &&
          typeof document !== "undefined" &&
          document.querySelector("[data-dailynotes-panel]")
        ) {
          renderRegion(app);
        }
      }, 400);
    })
    .catch(function () {});

  if (app.region) {
    renderRegion(app);
  }

  /* AC14.6: re-enable/reinstall rebuilds the chain from the surviving
     notes (the dailies themselves never left the scene). */
  listDailies(app)
    .then(function (dailies) {
      if (dailies.length > 1) {
        return reconcileChain(app, dailies);
      }
      return undefined;
    })
    .catch(function () {});
}

if (typeof window !== "undefined") {
  window.pluginMain = pluginMain;
} else if (typeof globalThis !== "undefined") {
  globalThis.pluginMain = pluginMain;
}
