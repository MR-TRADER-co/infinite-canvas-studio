/**
 * Reporter — the first-party stats plugin (R10.5).
 *
 * Subscribes to `planner.tasks` + `calendar.events`; renders stats for
 * day/week/month periods: completion counts, productive-day streaks,
 * overdue tasks, event counts; simple RTL SVG bar charts; a text
 * summary with copy + save-into-project.
 *
 * Degrades GRACEFULLY when either provider is missing/disabled: the
 * affected block hides behind a Persian notice; the panel keeps
 * rendering (the app NEVER crashes, AC10.2/AC10.5's spirit).
 *
 * The headless instance registers the `generate` command which computes
 * ALL THREE periods from the current contracts and writes the report
 * into the project section (`plugins.reporter`) — the same numbers the
 * panel shows (the panel recomputes live through the hub).
 *
 * Headless mode: command + panel registration. Region mode: the panel.
 */

/* eslint-disable */
var LANG = "fa";
var DICT = {
  fa: {
    panelTitle: "گزارش‌گر",
    day: "روز", week: "هفته", month: "ماه",
    completed: "انجام‌شده", pending: "در انتظار", overdue: "عقب‌افتاده",
    streak: "زنجیرهٔ روزهای پرکار", events: "رویدادهای تقویم",
    chart: "نمودار کارهای انجام‌شده", summary: "خلاصهٔ متنی",
    dailiesTitle: "یادداشت‌های روزانه",
    dailiesChart: "نمودار واژه‌های روزانه",
    dailiesMood: "روند حال‌وهوا",
    dailiesWords: "واژه‌",
    dailiesEntries: "یادداشت",
    dailiesAvg: "میانگین واژه در روز",
    dailiesStreak: "زنجیرهٔ روزهای نوشتن",
    dailiesMissing: "دادگان یادداشت روزانه در دسترس نیست (افزونهٔ آن را نصب کنید).",
    dailiesEmpty: "در این بازه یادداشتی نیست.",
    dailiesMoodEmpty: "خاصیت عددی (مثل mood) پیدا نشد.",
    refresh: "به‌روزرسانی", copy: "رونوشت", copied: "رونوشت شد.",
    save: "ذخیره در پروژه",
    plannerMissing: "دادگان برنامه‌ریز در دسترس نیست؛ آمار کارها خاموش است.",
    calendarMissing: "دادگان تقویم در دسترس نیست؛ شمار رویدادها خاموش است.",
    empty: "داده‌ای برای گزارش نیست."
  },
  en: {
    panelTitle: "Reporter",
    day: "Day", week: "Week", month: "Month",
    completed: "Completed", pending: "Pending", overdue: "Overdue",
    streak: "Productive-day streak", events: "Calendar events",
    chart: "Completed tasks chart", summary: "Text summary",
    dailiesTitle: "Daily notes",
    dailiesChart: "Words per day chart",
    dailiesMood: "Mood trend",
    dailiesWords: "words",
    dailiesEntries: "notes",
    dailiesAvg: "avg words/day",
    dailiesStreak: "Writing-day streak",
    dailiesMissing: "Daily-notes data unavailable (install the Daily Notes plugin).",
    dailiesEmpty: "No notes in this range.",
    dailiesMoodEmpty: "No numeric property (e.g. mood) found.",
    refresh: "Refresh", copy: "Copy", copied: "Copied.",
    save: "Save into project",
    plannerMissing: "Planner data unavailable; task stats are off.",
    calendarMissing: "Calendar data unavailable; event counts are off.",
    empty: "Nothing to report yet."
  }
};
function T(key) {
  return (DICT[LANG] && DICT[LANG][key]) || (DICT.fa[key] || key);
}

var PLANNER_RANGE = "^1";
var CALENDAR_RANGE = "^1";
var DAILIES_RANGE = "^1";

/* ---- pure stats core (shared by the command + the panel) ---- */

/* Exact jalaali-js conversion (same algorithm the host's core uses). */
var BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060,
  2097, 2192, 2262, 2324, 2394, 2456, 3178
];
function div(a, b) { return Math.trunc(a / b); }
function mod(a, b) { return a - div(a, b) * b; }
function jalCalLocal(jy) {
  var gy = jy + 621, leapJ = -14, jp = BREAKS[0], jump = BREAKS[1] - jp;
  for (var i = 1; i < BREAKS.length; i += 1) {
    if (jy < BREAKS[i]) { break; }
    jump = BREAKS[i] - jp;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = BREAKS[i];
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
function g2dLocal(gy, gm, gd) {
  var d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}
function d2gLocal(jdn) {
  var j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  var i = div(mod(j, 1461), 4) * 5 + 308;
  return {
    gd: div(mod(i, 153), 5) + 1,
    gm: mod(div(i, 153), 12) + 1,
    gy: div(j, 1461) - 100100 + div(8 - mod(div(i, 153), 12) - 1, 6)
  };
}
function gregorianToJalaliLocal(gy, gm, gd) {
  var jdn = g2dLocal(gy, gm, gd);
  var gy2 = d2gLocal(jdn).gy;
  var jy = gy2 - 621;
  var r = jalCalLocal(jy);
  var jdn1f = g2dLocal(gy2, 3, r.march);
  var k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 186) { return { jy: jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 }; }
    k -= 186;
    return { jy: jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
  }
  jy -= 1; k += 179;
  if (r.leap === 1) { k += 1; }
  return { jy: jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}
function timestampToJalali(ts) {
  var d = new Date(ts);
  return gregorianToJalaliLocal(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
function todayJalali() {
  return timestampToJalali(Date.now());
}
/** Jalali day index (JDN — monotone, safe for range math). */
function jalaliDayIndex(date) {
  return g2dOfJalali(date);
}
function g2dOfJalali(date) {
  var r = jalCalLocal(date.jy);
  return g2dLocal(r.gy, 3, r.march) +
    (date.jm - 1) * 31 - div(date.jm, 7) * (date.jm - 7) + date.jd - 1;
}

/**
 * Computes the stats for one period (pure — the report + panel share it).
 *
 * @param tasks - the planner tasks (id, title, status, due, completedAt).
 * @param events - the calendar events (jy, jm, jd).
 * @param period - "day" | "week" | "month".
 * @param today - the current Jalali date.
 * @returns the stats block.
 */
function computeStats(tasks, events, period, today) {
  var todayIndex = jalaliDayIndex(today);
  var span = period === "day" ? 1 : period === "week" ? 7 : 30;
  var fromIndex = todayIndex - (span - 1);

  var completed = 0;
  var perDay = {};
  var day, i;
  for (day = fromIndex; day <= todayIndex; day += 1) {
    perDay[day] = 0;
  }
  var completedDays = {};
  for (i = 0; i < tasks.length; i += 1) {
    var task = tasks[i];
    if (task.status === "done") {
      var completedAt = task.completedAt || task.createdAt || 0;
      var completedDate = timestampToJalali(completedAt);
      var completedIdx = jalaliDayIndex(completedDate);
      if (completedIdx >= fromIndex && completedIdx <= todayIndex) {
        completed += 1;
        if (perDay[completedIdx] === undefined) { perDay[completedIdx] = 0; }
        perDay[completedIdx] += 1;
        completedDays[completedIdx] = true;
      }
    }
  }

  /* streak: consecutive days ending today (or yesterday) with >= 1 completion */
  var streak = 0;
  var cursor = completedDays[todayIndex] === true ? todayIndex : todayIndex - 1;
  while (completedDays[cursor] === true) {
    streak += 1;
    cursor -= 1;
  }

  var pending = 0;
  var overdue = 0;
  var overdueTitles = [];
  for (i = 0; i < tasks.length; i += 1) {
    var task2 = tasks[i];
    if (task2.status !== "done") {
      pending += 1;
      if (task2.due) {
        var dueIdx = jalaliDayIndex(task2.due);
        if (dueIdx < todayIndex) {
          overdue += 1;
          overdueTitles.push(task2.title);
        }
      }
    }
  }

  var eventCount = 0;
  for (i = 0; i < events.length; i += 1) {
    var eventIdx = jalaliDayIndex(events[i]);
    if (eventIdx >= fromIndex && eventIdx <= todayIndex) {
      eventCount += 1;
    }
  }

  var buckets = [];
  for (day = fromIndex; day <= todayIndex; day += 1) {
    buckets.push({ dayIndex: day, count: perDay[day] || 0 });
  }

  return {
    period: period,
    generatedAt: Date.now(),
    completed: completed,
    pending: pending,
    overdue: overdue,
    overdueTitles: overdueTitles.slice(0, 8),
    streak: streak,
    events: eventCount,
    buckets: buckets
  };
}

function timestampToJalali(ts) {
  var d = new Date(ts);
  return gregorianToJalaliLocal(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** The RTL SVG bar chart (bars grow right→left, Persian day labels). */
function chartSvg(stats, period) {
  var buckets = stats.buckets;
  if (buckets.length === 0) { return ""; }
  var max = 1;
  buckets.forEach(function (bucket) {
    if (bucket.count > max) { max = bucket.count; }
  });
  var width = 260, height = 90;
  var pad = 8;
  var barSpace = (width - pad * 2) / buckets.length;
  var barWidth = Math.max(4, barSpace * 0.55);
  var bars = "";
  buckets.forEach(function (bucket, index) {
    var barHeight = (bucket.count / max) * (height - pad * 2 - 12);
    /* RTL: first bucket at the RIGHT edge. */
    var x = width - pad - (index + 1) * barSpace + (barSpace - barWidth) / 2;
    var y = height - pad - 6 - barHeight;
    bars +=
      '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' +
      barWidth.toFixed(1) + '" height="' + Math.max(1, barHeight).toFixed(1) +
      '" rx="2" fill="#a78bfa"/>';
    if (bucket.count > 0) {
      bars +=
        '<text x="' + (x + barWidth / 2).toFixed(1) + '" y="' + (y - 2).toFixed(1) +
        '" font-size="7" fill="#c4b5fd" text-anchor="middle">' + bucket.count + "</text>";
    }
  });
  var label =
    period === "day" ? "امروز" : period === "week" ? "۷ روز اخیر" : "۳۰ روز اخیر";
  return (
    '<svg viewBox="0 0 ' + width + " " + height + '" width="100%" height="' + height +
    '" direction="rtl" style="direction:rtl;">' +
    '<text x="' + (width - pad) + '" y="10" font-size="8" fill="#94a3b8" text-anchor="end">' +
    label + "</text>" + bars + "</svg>"
  );
}

/** The Persian text summary (task stats + the dailies block). */
function summaryText(stats, dailiesStats) {
  var lines = [];
  lines.push(
    "گزارش " +
      (stats.period === "day" ? "روزانه" : stats.period === "week" ? "هفتگی" : "ماهانه")
  );
  lines.push("کارهای انجام‌شده: " + stats.completed);
  lines.push("کارهای در انتظار: " + stats.pending);
  lines.push("عقب‌افتاده: " + stats.overdue);
  lines.push("زنجیرهٔ روزهای پرکار: " + stats.streak + " روز");
  lines.push("رویدادهای تقویم: " + stats.events);
  if (stats.overdueTitles.length > 0) {
    lines.push("عقب‌افتاده‌ها: " + stats.overdueTitles.join("، "));
  }
  if (dailiesStats !== null && dailiesStats.count > 0) {
    lines.push("");
    lines.push("یادداشت‌های روزانه: " + dailiesStats.count + " یادداشت");
    lines.push("واژه‌های ژورنال: " + dailiesStats.totalWords);
    lines.push("میانگین واژه در روز: " + dailiesStats.avgWords);
    lines.push("زنجیرهٔ روزهای نوشتن: " + dailiesStats.streak + " روز");
    if (dailiesStats.moodProp !== null) {
      lines.push(
        "روند «" + dailiesStats.moodProp + "»: " +
          dailiesStats.moodPoints
            .map(function (point) { return point.value; })
            .join(" ← ")
      );
    }
  }
  return lines.join("\n");
}

/* ---- contract reads (both instances use these) ---- */
function readPlannerTasks(app) {
  return app.datahub
    .query({ contractId: "planner.tasks", versionRange: PLANNER_RANGE, method: "getState", params: {} })
    .then(function (outcome) {
      if (!outcome || !outcome.ok) { return { ok: false, tasks: [] }; }
      var state = outcome.result;
      return {
        ok: true,
        tasks: Array.isArray(state && state.tasks) ? state.tasks : []
      };
    });
}
function readCalendarEvents(app) {
  return app.datahub
    .query({ contractId: "calendar.events", versionRange: CALENDAR_RANGE, method: "getEvents", params: {} })
    .then(function (outcome) {
      if (!outcome || !outcome.ok) { return { ok: false, events: [] }; }
      var result = outcome.result;
      return {
        ok: true,
        events: Array.isArray(result && result.events) ? result.events : []
      };
    });
}

/**
 * Pack-14 R14.4: the daily-journal read — dailies.entries v1,
 * degraded to {ok:false} when the dailynotes plugin is absent (the
 * affected block hides behind a Persian notice, AC14.4's spirit).
 */
function readDailies(app) {
  return app.datahub
    .query({
      contractId: "dailynotes.entries",
      versionRange: DAILIES_RANGE,
      method: "getEntries",
      params: {}
    })
    .then(function (outcome) {
      if (!outcome || !outcome.ok) {
        return { ok: false, entries: [] };
      }
      var result = outcome.result;
      return {
        ok: true,
        entries: Array.isArray(result && result.entries) ? result.entries : []
      };
    });
}

/** The dailies stats for one period (words/day, streak, mood trend). */
function computeDailiesStats(entries, period, today) {
  var todayIndex = jalaliDayIndex(today);
  var span = period === "day" ? 1 : period === "week" ? 7 : 30;
  var fromIndex = todayIndex - (span - 1);

  var inRange = [];
  var i;
  for (i = 0; i < entries.length; i += 1) {
    var entry = entries[i];
    var entryIdx = jalaliDayIndex(entryISO(entry));
    if (entryIdx >= fromIndex && entryIdx <= todayIndex) {
      inRange.push({
        entryIndex: entryIdx,
        wordCount: entry.wordCount || 0,
        properties: entry.properties || {},
        title: entry.title || entry.dateISO
      });
    }
  }

  var perDay = {};
  var writingDays = {};
  var totalWords = 0;
  for (i = 0; i < inRange.length; i += 1) {
    var day = inRange[i].entryIndex;
    perDay[day] = (perDay[day] || 0) + inRange[i].wordCount;
    writingDays[day] = true;
    totalWords += inRange[i].wordCount;
  }

  /* streak: consecutive days ending today (or yesterday) with a note */
  var streak = 0;
  var cursor = writingDays[todayIndex] === true ? todayIndex : todayIndex - 1;
  while (writingDays[cursor] === true) {
    streak += 1;
    cursor -= 1;
  }

  var buckets = [];
  var day2;
  for (day2 = fromIndex; day2 <= todayIndex; day2 += 1) {
    buckets.push({ dayIndex: day2, count: perDay[day2] || 0 });
  }

  /* the mood trend: the FIRST numeric property name (alphabetical)
   * every entry exposes beyond type/date/tags (e.g. mood 1..5). */
  var propNames = {};
  for (i = 0; i < inRange.length; i += 1) {
    var props = inRange[i].properties;
    Object.keys(props).forEach(function (name) {
      if (name === "type" || name === "date" || name === "tags") { return; }
      if (typeof props[name] === "number") { propNames[name] = true; }
    });
  }
  var moodProp = Object.keys(propNames).sort()[0] || null;
  var moodPoints = [];
  if (moodProp !== null) {
    for (i = 0; i < inRange.length; i += 1) {
      var value = inRange[i].properties[moodProp];
      if (typeof value === "number") {
        moodPoints.push({
          dayIndex: inRange[i].entryIndex,
          value: value,
          title: inRange[i].title
        });
      }
    }
    moodPoints.sort(function (a, b) { return a.dayIndex - b.dayIndex; });
  }

  return {
    period: period,
    count: inRange.length,
    totalWords: totalWords,
    avgWords: inRange.length === 0 ? 0 : Math.round(totalWords / inRange.length),
    streak: streak,
    buckets: buckets,
    moodProp: moodProp,
    moodPoints: moodPoints
  };
}

function entryISO(entry) {
  if (typeof entry.dateISO === "string") { return entry.dateISO; }
  var props = entry.properties || {};
  return typeof props.date === "string" ? props.date : "";
}

/** The dailies word-count bar chart (teal, RTL). */
function dailiesChartSvg(stats, period) {
  var buckets = stats.buckets;
  if (buckets.length === 0) { return ""; }
  var max = 1;
  buckets.forEach(function (bucket) {
    if (bucket.count > max) { max = bucket.count; }
  });
  var width = 260, height = 90;
  var pad = 8;
  var barSpace = (width - pad * 2) / buckets.length;
  var barWidth = Math.max(4, barSpace * 0.55);
  var bars = "";
  buckets.forEach(function (bucket, index) {
    var barHeight = (bucket.count / max) * (height - pad * 2 - 12);
    var x = width - pad - (index + 1) * barSpace + (barSpace - barWidth) / 2;
    var y = height - pad - 6 - barHeight;
    bars +=
      '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' +
      barWidth.toFixed(1) + '" height="' + Math.max(1, barHeight).toFixed(1) +
      '" rx="2" fill="#2dd4bf"/>';
    if (bucket.count > 0) {
      bars +=
        '<text x="' + (x + barWidth / 2).toFixed(1) + '" y="' + (y - 2).toFixed(1) +
        '" font-size="7" fill="#5eead4" text-anchor="middle">' + bucket.count + "</text>";
    }
  });
  var label =
    period === "day" ? T("dailiesTitle") + " · امروز" :
    period === "week" ? "۷ روز اخیر" : "۳۰ روز اخیر";
  return (
    '<svg viewBox="0 0 ' + width + " " + height + '" width="100%" height="' + height +
    '" direction="rtl" style="direction:rtl;">' +
    '<text x="' + (width - pad) + '" y="10" font-size="8" fill="#94a3b8" text-anchor="end">' +
    label + "</text>" + bars + "</svg>"
  );
}

/** The mood-trend RTL line chart (a polyline, dots, day labels). */
function moodChartSvg(points) {
  if (points.length === 0) { return ""; }
  var width = 260, height = 84;
  var pad = 10;
  var values = points.map(function (p) { return p.value; });
  var minV = Math.min.apply(null, values);
  var maxV = Math.max.apply(null, values);
  if (minV === maxV) { maxV = minV + 1; }
  var step = points.length === 1 ? 0 : (width - pad * 2) / (points.length - 1);
  function px(i) {
    /* RTL: the earliest point sits at the RIGHT edge. */
    return points.length === 1 ? width / 2 : width - pad - i * step;
  }
  function py(v) {
    return height - pad - ((v - minV) / (maxV - minV)) * (height - pad * 2 - 10);
  }
  var poly = points
    .map(function (p, i) { return px(i).toFixed(1) + "," + py(p.value).toFixed(1); })
    .join(" ");
  var dots = "";
  points.forEach(function (p, i) {
    dots +=
      '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(p.value).toFixed(1) +
      '" r="2.6" fill="#2dd4bf" stroke="#134e4a" stroke-width="1"/>' +
      '<text x="' + px(i).toFixed(1) + '" y="' + (py(p.value) - 5).toFixed(1) +
      '" font-size="7" fill="#5eead4" text-anchor="middle">' + p.value + "</text>";
  });
  return (
    '<svg viewBox="0 0 ' + width + " " + height + '" width="100%" height="' + height +
    '" direction="rtl" style="direction:rtl;">' +
    '<text x="' + (width - pad) + '" y="10" font-size="8" fill="#94a3b8" text-anchor="end">' +
    T("dailiesMood") + " (" + (points[0] && points[0].title || "") + ")</text>" +
    '<polyline points="' + poly + '" fill="none" stroke="#2dd4bf" stroke-width="1.8" ' +
    'stroke-linejoin="round" stroke-linecap="round"/>' + dots + "</svg>"
  );
}

/** Builds the full report (all three periods). */
function buildReport(app) {
  return readPlannerTasks(app).then(function (planner) {
    return readCalendarEvents(app).then(function (calendar) {
      return readDailies(app).then(function (dailies) {
        var today = todayJalali();
        var periods = ["day", "week", "month"].map(function (period) {
          return computeStats(planner.tasks, calendar.events, period, today);
        });
        var dailiesPeriods = ["day", "week", "month"].map(function (period) {
          return computeDailiesStats(dailies.entries, period, today);
        });
        return {
          plannerAvailable: planner.ok,
          calendarAvailable: calendar.ok,
          dailiesAvailable: dailies.ok,
          plannerNotice: planner.ok ? null : T("plannerMissing"),
          calendarNotice: calendar.ok ? null : T("calendarMissing"),
          dailiesNotice: dailies.ok ? null : T("dailiesMissing"),
          generatedAt: Date.now(),
          day: periods[0],
          week: periods[1],
          month: periods[2],
          dailiesDay: dailiesPeriods[0],
          dailiesWeek: dailiesPeriods[1],
          dailiesMonth: dailiesPeriods[2]
        };
      });
    });
  });
}

function pluginMain(app) {
  if (app.region) {
    renderRegion(app);
    app.events.on("ui:language-changed", function (payload) {
      LANG = payload && payload.language === "en" ? "en" : "fa";
      renderRegion(app);
    });
    /* live refresh on data changes (R10.5 subscribes to both). */
    app.datahub.subscribe({ contractId: "planner.tasks", versionRange: PLANNER_RANGE }, function () {
      renderRegion(app);
    });
    app.datahub.subscribe({ contractId: "calendar.events", versionRange: CALENDAR_RANGE }, function () {
      renderRegion(app);
    });
    /* R14.4: live refresh on journal changes too. */
    app.datahub.subscribe({ contractId: "dailynotes.entries", versionRange: DAILIES_RANGE }, function () {
      renderRegion(app);
    });
    return;
  }

  /* ---- headless: the generate command + the panel ---- */
  app.commands.register({
    id: "generate",
    titleKey: "reporter:command.generate",
    icon: "ChartColumn",
    execute: function () {
      buildReport(app).then(function (report) {
        app.project.write(report);
      });
    }
  });

  app.panels.register({
    id: "main",
    titleKey: "reporter:panel.title",
    icon: "ChartColumn",
    placement: "right",
    order: 320
  });
}

/* ---- the panel region ---- */

var reportState = { period: "day" };

function renderRegion(app) {
  document.body.innerHTML = "";
  document.body.dir = LANG === "en" ? "ltr" : "rtl";
  document.body.style.cssText =
    "margin:0;padding:10px;font:12px/1.7 system-ui,sans-serif;" +
    "color:#e7e5e4;background:transparent;";

  buildReport(app).then(function (report) {
    drawPanel(app, report);
  });
}

function drawPanel(app, report) {
  var box = document.createElement("div");
  box.style.cssText = "display:flex;flex-direction:column;gap:8px;";

  /* period selector */
  var periods = document.createElement("div");
  periods.style.cssText = "display:flex;gap:4px;";
  ["day", "week", "month"].forEach(function (period) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = T(period);
    button.style.cssText =
      "flex:1;padding:4px;border-radius:8px;cursor:pointer;font:inherit;" +
      "border:1px solid rgba(148,163,184,.35);color:#e7e5e4;" +
      (reportState.period === period
        ? "background:rgba(167,139,250,.35);"
        : "background:rgba(15,23,42,.55);");
    button.addEventListener("click", function () {
      reportState.period = period;
      drawPanel(app, report);
    });
    periods.appendChild(button);
  });
  box.appendChild(periods);

  /* degradation notices (AC10.2-style: notice, feature off, no crash) */
  [report.plannerNotice, report.calendarNotice, report.dailiesNotice].forEach(function (notice) {
    if (notice === null) { return; }
    var note = document.createElement("p");
    note.textContent = notice;
    note.style.cssText =
      "margin:0;font-size:10px;color:#fbbf24;background:rgba(251,191,36,.1);" +
      "border-radius:8px;padding:4px 8px;";
    box.appendChild(note);
  });

  var stats = report[reportState.period];

  /* stat cards */
  var cards = document.createElement("div");
  cards.style.cssText =
    "display:grid;grid-template-columns:repeat(2,1fr);gap:4px;";
  [
    { label: T("completed"), value: stats.completed, colour: "#34d399" },
    { label: T("pending"), value: stats.pending, colour: "#fbbf24" },
    { label: T("overdue"), value: stats.overdue, colour: "#f87171" },
    { label: T("streak"), value: stats.streak, colour: "#38bdf8" }
  ].forEach(function (card) {
    var el = document.createElement("div");
    el.style.cssText =
      "border:1px solid rgba(148,163,184,.3);border-radius:10px;padding:6px 8px;" +
      "background:rgba(15,23,42,.5);";
    var value = document.createElement("p");
    value.style.cssText = "margin:0;font-size:16px;font-weight:700;color:" + card.colour + ";";
    value.textContent = String(card.value);
    var label = document.createElement("p");
    label.style.cssText = "margin:0;font-size:9px;opacity:.75;";
    label.textContent = card.label;
    el.appendChild(value);
    el.appendChild(label);
    cards.appendChild(el);
  });
  box.appendChild(cards);

  /* the RTL SVG chart */
  var chartBox = document.createElement("div");
  chartBox.style.cssText =
    "border:1px solid rgba(148,163,184,.3);border-radius:10px;padding:6px;" +
    "background:rgba(15,23,42,.5);";
  var chartTitle = document.createElement("p");
  chartTitle.style.cssText = "margin:0 0 2px;font-size:10px;opacity:.75;";
  chartTitle.textContent = T("chart");
  chartBox.appendChild(chartTitle);
  chartBox.insertAdjacentHTML("beforeend", chartSvg(stats, reportState.period));
  box.appendChild(chartBox);

  /* events count (hidden block when calendar missing) */
  if (report.calendarAvailable) {
    var eventsRow = document.createElement("p");
    eventsRow.style.cssText =
      "margin:0;font-size:10px;opacity:.8;";
    eventsRow.textContent = T("events") + ": " + report[reportState.period].events;
    box.appendChild(eventsRow);
  }

  /* R14.4: the dailies block — stats + the words/day bar chart + the
   * mood-trend line (teal, RTL); hidden behind a notice when the
   * dailynotes plugin is absent, quiet when the range is empty. */
  if (report.dailiesAvailable) {
    var dailiesStats =
      report["dailies" + (reportState.period === "day" ? "Day" : reportState.period === "week" ? "Week" : "Month")];
    if (dailiesStats.count > 0) {
      var dailiesBox = document.createElement("div");
      dailiesBox.style.cssText =
        "margin-top:2px;display:flex;flex-direction:column;gap:6px;";

      var dailiesHeader = document.createElement("div");
      dailiesHeader.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;" +
        "font-size:11px;font-weight:700;color:#5eead4;";
      var dailiesTitle = document.createElement("span");
      dailiesTitle.textContent = T("dailiesTitle");
      var dailiesCount = document.createElement("span");
      dailiesCount.style.cssText = "font-size:10px;color:#a8a29e;";
      dailiesCount.textContent =
        dailiesStats.count + " " + T("dailiesEntries") + " · " +
        dailiesStats.totalWords + " " + T("dailiesWords");
      dailiesHeader.appendChild(dailiesTitle);
      dailiesHeader.appendChild(dailiesCount);
      dailiesBox.appendChild(dailiesHeader);

      var dailiesCards = document.createElement("div");
      dailiesCards.style.cssText =
        "display:grid;grid-template-columns:repeat(2,1fr);gap:4px;";
      [
        { label: T("dailiesAvg"), value: dailiesStats.avgWords },
        { label: T("dailiesStreak"), value: dailiesStats.streak }
      ].forEach(function (card) {
        var el = document.createElement("div");
        el.style.cssText =
          "border:1px solid rgba(45,212,191,.28);border-radius:10px;padding:5px 8px;" +
          "background:rgba(45,212,191,.06);";
        var value = document.createElement("p");
        value.style.cssText =
          "margin:0;font-size:15px;font-weight:700;color:#2dd4bf;";
        value.textContent = String(card.value);
        var label = document.createElement("p");
        label.style.cssText = "margin:0;font-size:9px;opacity:.75;";
        label.textContent = card.label;
        el.appendChild(value);
        el.appendChild(label);
        dailiesCards.appendChild(el);
      });
      dailiesBox.appendChild(dailiesCards);

      var wordsChartBox = document.createElement("div");
      wordsChartBox.style.cssText =
        "border:1px solid rgba(45,212,191,.28);border-radius:10px;padding:6px;" +
        "background:rgba(45,212,191,.05);";
      var wordsChartTitle = document.createElement("p");
      wordsChartTitle.style.cssText =
        "margin:0 0 2px;font-size:10px;color:#5eead4;opacity:.85;";
      wordsChartTitle.textContent = T("dailiesChart");
      wordsChartBox.appendChild(wordsChartTitle);
      wordsChartBox.insertAdjacentHTML(
        "beforeend",
        dailiesChartSvg(dailiesStats, reportState.period)
      );
      dailiesBox.appendChild(wordsChartBox);

      if (dailiesStats.moodPoints.length > 1) {
        var moodBox = document.createElement("div");
        moodBox.style.cssText =
          "border:1px solid rgba(45,212,191,.28);border-radius:10px;padding:6px;" +
          "background:rgba(45,212,191,.05);";
        moodBox.insertAdjacentHTML(
          "beforeend",
          moodChartSvg(dailiesStats.moodPoints)
        );
        dailiesBox.appendChild(moodBox);
      }

      box.appendChild(dailiesBox);
    }
  }

  /* summary + copy + save */
  var summaryBox = document.createElement("div");
  summaryBox.style.cssText =
    "border:1px solid rgba(148,163,184,.3);border-radius:10px;padding:6px;" +
    "background:rgba(15,23,42,.5);";
  var summaryTitle = document.createElement("p");
  summaryTitle.style.cssText = "margin:0 0 4px;font-size:10px;opacity:.75;";
  summaryTitle.textContent = T("summary");
  summaryBox.appendChild(summaryTitle);
  var textarea = document.createElement("textarea");
  textarea.readOnly = true;
  textarea.style.cssText =
    "width:100%;height:110px;resize:none;font:11px/1.6 system-ui,sans-serif;" +
    "color:#e7e5e4;background:rgba(2,6,23,.6);border:none;outline:none;box-sizing:border-box;";
  textarea.value = summaryText(stats, report.dailiesAvailable ? report["dailies" + (reportState.period === "day" ? "Day" : reportState.period === "week" ? "Week" : "Month")] : null);
  summaryBox.appendChild(textarea);
  var actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:4px;margin-top:4px;";
  var copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = T("copy");
  copy.style.cssText = "flex:1;padding:4px;border-radius:8px;cursor:pointer;font:inherit;" +
    "border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.55);color:#e7e5e4;";
  copy.addEventListener("click", function () {
    textarea.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    if (!ok && navigator.clipboard) {
      navigator.clipboard.writeText(textarea.value).catch(function () {});
    }
    copy.textContent = T("copied");
    setTimeout(function () { copy.textContent = T("copy"); }, 1500);
  });
  var save = document.createElement("button");
  save.type = "button";
  save.textContent = T("save");
  save.style.cssText = "flex:1;padding:4px;border-radius:8px;cursor:pointer;font:inherit;" +
    "border:1px solid rgba(52,211,153,.4);background:rgba(52,211,153,.15);color:#e7e5e4;";
  save.addEventListener("click", function () {
    buildReport(app).then(function (fresh) {
      app.project.write(fresh);
    });
  });
  actions.appendChild(copy);
  actions.appendChild(save);
  summaryBox.appendChild(actions);
  box.appendChild(summaryBox);

  document.body.appendChild(box);
}
