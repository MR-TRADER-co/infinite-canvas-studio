/**
 * Planner — the first-party planner plugin (R10.4).
 *
 * Provides the `planner.tasks` v1 datahub contract:
 *   getState / addGoal / updateGoal / deleteGoal / addTask / updateTask /
 *   completeTask / deleteTask / queryTasks
 * (goals long/short-term, tasks with status + Jalali due dates, queryable
 * by range/status/goal) + task-card and goal-board canvas widgets
 * (catalog cards in the Insert Panel) + the «برنامه‌ریز» panel.
 *
 * CONSUMES `calendar.events` (^1) for date picking/display — the due-date
 * picker renders the calendar's month grid; when the contract is
 * unavailable (calendar disabled / version mismatch) the panel shows the
 * Persian notice and falls back to manual date entry (AC10.2).
 *
 * Data scope: PER-PROJECT (the project file's `plugins.planner`
 * section) with a GLOBAL overview toggle (every project's dataset seen
 * on this device is mirrored into plugin storage — DECISIONS.md).
 *
 * Headless mode: contract + registrations. Region mode: the panel.
 */

/* eslint-disable */
var LANG = "fa";
var DICT = {
  fa: {
    panelTitle: "برنامه‌ریز",
    goals: "اهداف",
    addGoal: "افزودن هدف",
    goalTitle: "عنوان هدف",
    longTerm: "بلندمدت",
    shortTerm: "کوتاه‌مدت",
    tasks: "کارها",
    addTask: "افزودن کار",
    taskTitle: "عنوان کار",
    assignGoal: "هدف مرتبط",
    noGoal: "بدون هدف",
    due: "سررسید",
    pickDate: "انتخاب از تقویم",
    manualDate: "ورود دستی تاریخ (۱۴۰۳/۰۵/۲۱)",
    pending: "در انتظار",
    done: "انجام‌شده",
    overview: "نمای کلی (همهٔ پروژه‌ها)",
    projectView: "نمای این پروژه",
    calendarUnavailable: "تقویم در دسترس نیست؛ تاریخ را دستی وارد کنید.",
    calendarOn: "اتصال به تقویم برقرار است.",
    noGoals: "هدفی ثبت نشده است.",
    noTasks: "کاری ثبت نشده است.",
    delete: "حذف",
    complete: "انجام شد",
    reopen: "بازگشایی",
    deleteConfirm: "حذف شود؟",
    today: "امروز",
    prev: "ماه قبل",
    next: "ماه بعد"
  },
  en: {
    panelTitle: "Planner",
    goals: "Goals",
    addGoal: "Add goal",
    goalTitle: "Goal title",
    longTerm: "Long-term",
    shortTerm: "Short-term",
    tasks: "Tasks",
    addTask: "Add task",
    taskTitle: "Task title",
    assignGoal: "Related goal",
    noGoal: "No goal",
    due: "Due",
    pickDate: "Pick from calendar",
    manualDate: "Enter date manually (1403/05/21)",
    pending: "Pending",
    done: "Done",
    overview: "Global overview (all projects)",
    projectView: "This project's view",
    calendarUnavailable: "Calendar unavailable; enter the date manually.",
    calendarOn: "Connected to the calendar.",
    noGoals: "No goals yet.",
    noTasks: "No tasks yet.",
    delete: "Delete",
    complete: "Done",
    reopen: "Reopen",
    deleteConfirm: "Delete?",
    today: "Today",
    prev: "Previous month",
    next: "Next month"
  }
};
function T(key) {
  return (DICT[LANG] && DICT[LANG][key]) || (DICT.fa[key] || key);
}

var JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"
];

/* Jalali today (a tiny converter is enough for display — the CONTRACT
 * side uses the calendar plugin's conversions when available). */
var BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060,
  2097, 2192, 2262, 2324, 2394, 2456, 3178
];
function div(a, b) { return Math.trunc(a / b); }
function mod(a, b) { return a - div(a, b) * b; }
function jalCal(jy) {
  var gy = jy + 621, leapJ = -14;
  var jp = BREAKS[0], jump = BREAKS[1] - jp;
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
  return {
    gd: div(mod(i, 153), 5) + 1,
    gm: mod(div(i, 153), 12) + 1,
    gy: div(j, 1461) - 100100 + div(8 - mod(div(i, 153), 12) + 1, 6)
  };
}
function toJalali(gy, gm, gd) {
  var jdn = g2d(gy, gm, gd);
  var gy2 = d2g(jdn).gy;
  var jy = gy2 - 621;
  var r = jalCal(jy);
  var jdn1f = g2d(gy2, 3, r.march);
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
function todayJalali() {
  return toJalali(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    new Date().getDate()
  );
}
function jalaliMonthLength(jy, jm) {
  if (jm <= 6) { return 31; }
  if (jm <= 11) { return 30; }
  return jalCal(jy).leap === 0 ? 30 : 29;
}
function weekdayOfJalali(jy, jm, jd) {
  /* local fallback for grid layout when the calendar's monthInfo is
   * unavailable; the picker itself uses the calendar when connected. */
  var g = d2g(g2d(jy, jm, jd));
  var js = new Date(Date.UTC(g.gy, g.gm - 1, g.gd));
  return (js.getUTCDay() + 1) % 7;
}

/* ---- per-project state (the project file's plugin section) ---- */
var GLOBAL_KEY = "globalIndex";

function emptyState() {
  return {
    projectId: "pp:" + Date.now() + ":" + Math.floor(Math.random() * 1e6),
    goals: [],
    tasks: []
  };
}
function readState(app) {
  return app.project.read().then(function (data) {
    if (data && typeof data === "object" && Array.isArray(data.tasks)) {
      return data;
    }
    return emptyState();
  });
}
function writeState(app, state) {
  return app.project.write(state).then(function () {
    /* mirror into the global overview index (storage) */
    return app.storage.get(GLOBAL_KEY).then(function (raw) {
      var index = raw && typeof raw === "object" && Array.isArray(raw.projects)
        ? raw
        : { projects: [] };
      var entry = {
        projectId: state.projectId,
        goals: state.goals,
        tasks: state.tasks,
        updatedAt: Date.now()
      };
      var found = false;
      index.projects = index.projects.map(function (project) {
        if (project.projectId === state.projectId) { found = true; return entry; }
        return project;
      });
      if (!found) { index.projects.push(entry); }
      return app.storage.set(GLOBAL_KEY, index);
    });
  });
}

function publishChange(app, change) {
  app.datahub
    .publish({ contractId: "planner.tasks", change: change })
    .catch(function () { /* degrades on its own */ });
}

/** Persists + publishes in one step (the mutation pipeline). */
function mutate(app, mutator) {
  return readState(app).then(function (state) {
    var change = mutator(state) || { type: "state-updated" };
    return writeState(app, state).then(function () {
      publishChange(app, change);
      return state;
    });
  });
}

/* ---- the planner.tasks v1 contract handler ---- */
function contractQuery(method, params) {
  var app = this.app;
  var p = params || {};
  switch (method) {
    case "getState":
      return readState(app);
    case "addGoal": {
      if (!p.title || typeof p.title !== "string") {
        throw new Error("عنوان هدف لازم است.");
      }
      var goalId = "goal:" + Date.now() + ":" + Math.floor(Math.random() * 1e6);
      return mutate(app, function (state) {
        state.goals.push({
          id: goalId,
          title: p.title,
          kind: p.kind === "long" ? "long" : "short",
          createdAt: Date.now()
        });
        return { type: "goal-added", goalId: goalId };
      }).then(function (state) {
        return { goal: state.goals.find(function (goal) { return goal.id === goalId; }) };
      });
    }
    case "updateGoal": {
      return mutate(app, function (state) {
        state.goals = state.goals.map(function (goal) {
          if (goal.id !== p.id) { return goal; }
          if (p.patch && p.patch.title) { goal.title = String(p.patch.title); }
          if (p.patch && (p.patch.kind === "long" || p.patch.kind === "short")) {
            goal.kind = p.patch.kind;
          }
          return goal;
        });
        return { type: "goal-updated", goalId: p.id };
      }).then(function () { return { ok: true }; });
    }
    case "deleteGoal": {
      return mutate(app, function (state) {
        state.goals = state.goals.filter(function (goal) { return goal.id !== p.id; });
        state.tasks = state.tasks.map(function (task) {
          if (task.goalId === p.id) { task.goalId = null; }
          return task;
        });
        return { type: "goal-deleted", goalId: p.id };
      }).then(function () { return { ok: true }; });
    }
    case "addTask": {
      if (!p.title || typeof p.title !== "string") {
        throw new Error("عنوان کار لازم است.");
      }
      var taskId = "task:" + Date.now() + ":" + Math.floor(Math.random() * 1e6);
      return mutate(app, function (state) {
        state.tasks.push({
          id: taskId,
          title: p.title,
          goalId: typeof p.goalId === "string" ? p.goalId : null,
          status: "pending",
          due: p.due && typeof p.due === "object" ? p.due : null,
          createdAt: Date.now(),
          completedAt: null
        });
        return { type: "task-added", taskId: taskId };
      }).then(function (state) {
        return { task: state.tasks.find(function (task) { return task.id === taskId; }) };
      });
    }
    case "updateTask": {
      return mutate(app, function (state) {
        var changed = null;
        state.tasks = state.tasks.map(function (task) {
          if (task.id !== p.id) { return task; }
          if (p.patch && p.patch.title) { task.title = String(p.patch.title); }
          if (p.patch && p.patch.goalId !== undefined) { task.goalId = p.patch.goalId; }
          if (p.patch && p.patch.due !== undefined) { task.due = p.patch.due; }
          changed = task;
          return task;
        });
        return { type: "task-updated", taskId: p.id, task: changed };
      }).then(function () { return { ok: true }; });
    }
    case "completeTask": {
      return mutate(app, function (state) {
        var completed = null;
        state.tasks = state.tasks.map(function (task) {
          if (task.id !== p.id) { return task; }
          task.status = "done";
          task.completedAt = Date.now();
          completed = task;
          return task;
        });
        return { type: "task-completed", taskId: p.id, task: completed };
      }).then(function (state) {
        return {
          task: state.tasks.find(function (task) { return task.id === p.id; })
        };
      });
    }
    case "reopenTask": {
      return mutate(app, function (state) {
        state.tasks = state.tasks.map(function (task) {
          if (task.id !== p.id) { return task; }
          task.status = "pending";
          task.completedAt = null;
          return task;
        });
        return { type: "task-updated", taskId: p.id };
      }).then(function () { return { ok: true }; });
    }
    case "deleteTask": {
      return mutate(app, function (state) {
        state.tasks = state.tasks.filter(function (task) { return task.id !== p.id; });
        return { type: "task-deleted", taskId: p.id };
      }).then(function () { return { ok: true }; });
    }
    case "queryTasks": {
      return readState(app).then(function (state) {
        var today = todayJalali();
        var tasks = state.tasks.filter(function (task) {
          if (p.status && task.status !== p.status) { return false; }
          if (p.goalId && task.goalId !== p.goalId) { return false; }
          if (p.overdue && !(task.status === "pending" && task.due && dateLess(task.due, today))) {
            return false;
          }
          return true;
        });
        return { tasks: tasks, today: today };
      });
    }
    default:
      throw new Error("روش ناشناخته: " + method);
  }
}

function dateLess(a, b) {
  if (a.jy !== b.jy) { return a.jy < b.jy; }
  if (a.jm !== b.jm) { return a.jm < b.jm; }
  return a.jd < b.jd;
}

/* ---- widgets (pure HTML snapshots) ---- */
function taskCardHtml(data) {
  var done = data.status === "done";
  return (
    '<div dir="rtl" style="width:100%;height:100%;padding:12px;box-sizing:border-box;' +
    "border-radius:12px;background:" +
    (done ? "rgba(52,211,153,.18);border:1px solid rgba(52,211,153,.4);" : "rgba(15,23,42,.6);border:1px solid rgba(148,163,184,.35);") +
    'color:#e7e5e4;font:12px/1.7 system-ui,sans-serif;display:flex;flex-direction:column;gap:6px;">' +
    '<div style="display:flex;align-items:center;gap:8px;">' +
    '<span style="width:18px;height:18px;border-radius:5px;display:inline-flex;align-items:center;' +
    "justify-content:center;border:1.5px solid " +
    (done ? "#34d399;background:#34d399;color:#0f172a;" : "rgba(148,163,184,.6);") +
    'font-size:11px;">' + (done ? "✓" : "") + "</span>" +
    '<span style="font-weight:600;font-size:13px;' + (done ? "opacity:.7;" : "") + '">' +
    (data.title || "کار") + "</span></div>" +
    '<div style="display:flex;justify-content:space-between;opacity:.75;font-size:10px;">' +
    "<span>" + (done ? "انجام‌شده" : "در انتظار") + "</span>" +
    "<span>سررسید: " + (data.due ? data.due.jy + "/" + data.due.jm + "/" + data.due.jd : "—") + "</span></div>" +
    "</div>"
  );
}

function goalBoardHtml(data) {
  var pending = (data.tasks || []).filter(function (task) { return task.status !== "done"; });
  var done = (data.tasks || []).filter(function (task) { return task.status === "done"; });
  function column(title, tasks, colour) {
    var items = tasks
      .map(function (task) {
        return (
          '<div style="background:rgba(15,23,42,.7);border-radius:8px;padding:4px 8px;' +
          'margin-bottom:4px;font-size:10px;">' + (task.title || "کار") +
          (task.due
            ? ' <span style="opacity:.6">(' + task.due.jy + "/" + task.due.jm + "/" + task.due.jd + ")</span>"
            : "") +
          "</div>"
        );
      })
      .join("");
    return (
      '<div style="flex:1;display:flex;flex-direction:column;gap:4px;">' +
      '<div style="font-size:10px;font-weight:700;color:' + colour + ';">' + title + " (" + tasks.length + ")</div>" +
      items + "</div>"
    );
  }
  return (
    '<div dir="rtl" style="width:100%;height:100%;padding:10px;box-sizing:border-box;' +
    'border-radius:12px;background:rgba(15,23,42,.55);color:#e7e5e4;' +
    'font:11px/1.6 system-ui,sans-serif;display:flex;flex-direction:column;gap:8px;">' +
    '<div style="font-weight:700;font-size:12px;">🎯 ' + (data.goalTitle || "هدف") + "</div>" +
    '<div style="display:flex;gap:8px;flex:1;">' +
    column("در انتظار", pending, "#fbbf24") +
    column("انجام‌شده", done, "#34d399") +
    "</div></div>"
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
    contractId: "planner.tasks",
    version: "1.0.0",
    methods: [
      "getState", "addGoal", "updateGoal", "deleteGoal", "addTask",
      "updateTask", "completeTask", "reopenTask", "deleteTask", "queryTasks"
    ],
    query: function (method, params) {
      return contractQuery.call({ app: app }, method, params);
    }
  });

  app.objects.register({
    id: "taskCard",
    titleKey: "planner:taskCard.title",
    group: "planner:group",
    order: 21,
    icon: "SquareCheckBig",
    preview: "✅",
    width: 200,
    height: 90,
    factory: function () {
      return readState(app).then(function (state) {
        var today = todayJalali();
        var task =
          state.tasks.find(function (candidate) {
            return candidate.status === "pending" && candidate.due &&
              candidate.due.jy === today.jy && candidate.due.jm === today.jm &&
              candidate.due.jd === today.jd;
          }) ||
          state.tasks.find(function (candidate) { return candidate.status === "pending"; }) ||
          state.tasks[state.tasks.length - 1];
        return {
          taskId: task ? task.id : null,
          title: task ? task.title : "کار تازه",
          status: task ? task.status : "pending",
          due: task ? task.due : null
        };
      });
    },
    renderWidget: function (data) {
      return taskCardHtml(data || {});
    }
  });

  app.objects.register({
    id: "goalBoard",
    titleKey: "planner:goalBoard.title",
    group: "planner:group",
    order: 22,
    icon: "KanbanSquare",
    preview: "🎯",
    width: 360,
    height: 220,
    factory: function () {
      return readState(app).then(function (state) {
        var goal = state.goals[0] || null;
        var tasks = state.tasks.filter(function (task) {
          return goal === null || task.goalId === goal.id;
        });
        return {
          goalId: goal ? goal.id : null,
          goalTitle: goal ? goal.title : "هدف تازه",
          tasks: tasks.map(function (task) {
            return { title: task.title, status: task.status, due: task.due };
          })
        };
      });
    },
    renderWidget: function (data) {
      return goalBoardHtml(data || {});
    }
  });

  app.commands.register({
    id: "insertTaskCard",
    titleKey: "planner:command.insertTaskCard",
    icon: "SquareCheckBig",
    execute: function () {
      app.objects.create("taskCard");
    }
  });

  app.panels.register({
    id: "main",
    titleKey: "planner:panel.title",
    icon: "SquareCheckBig",
    placement: "right",
    order: 310
  });
}

/* ---- the panel region ---- */

var panelState = {
  overview: false,
  pickerOpen: false,
  pickerJy: null,
  pickerJm: null,
  calendarNotice: null
};

function renderRegion(app) {
  document.body.innerHTML = "";
  document.body.dir = LANG === "en" ? "ltr" : "rtl";
  document.body.style.cssText =
    "margin:0;padding:10px;font:12px/1.7 system-ui,sans-serif;" +
    "color:#e7e5e4;background:transparent;";

  if (panelState.overview) {
    app.storage.get(GLOBAL_KEY).then(function (raw) {
      var index = raw && typeof raw === "object" ? raw : { projects: [] };
      drawOverview(app, index.projects || []);
    });
    return;
  }
  readState(app).then(function (state) {
    drawPanel(app, state);
  });
}

function drawOverview(app, projects) {
  var box = document.createElement("div");
  box.style.cssText = "display:flex;flex-direction:column;gap:8px;";
  var toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = T("projectView");
  toggle.style.cssText = BUTTON_STYLE;
  toggle.addEventListener("click", function () {
    panelState.overview = false;
    renderRegion(app);
  });
  box.appendChild(toggle);
  if (projects.length === 0) {
    var empty = document.createElement("p");
    empty.textContent = T("noGoals");
    empty.style.cssText = "opacity:.6;";
    box.appendChild(empty);
  }
  projects.forEach(function (project) {
    var card = document.createElement("div");
    card.style.cssText =
      "border:1px solid rgba(148,163,184,.3);border-radius:10px;padding:8px;";
    var title = document.createElement("p");
    title.style.cssText = "margin:0 0 4px;font-weight:600;font-size:11px;";
    title.textContent =
      (project.goals ? project.goals.length : 0) + " " + T("goals") + " · " +
      (project.tasks ? project.tasks.length : 0) + " " + T("tasks");
    card.appendChild(title);
    (project.goals || []).forEach(function (goal) {
      var row = document.createElement("div");
      row.style.cssText = "font-size:10px;opacity:.8;";
      row.textContent =
        (goal.kind === "long" ? "🎯" : "⚡") + " " + goal.title;
      card.appendChild(row);
    });
    box.appendChild(card);
  });
  document.body.appendChild(box);
}

function drawPanel(app, state) {
  var box = document.createElement("div");
  box.style.cssText = "display:flex;flex-direction:column;gap:10px;";

  /* overview toggle */
  var toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = T("overview");
  toggle.style.cssText = BUTTON_STYLE;
  toggle.addEventListener("click", function () {
    panelState.overview = true;
    renderRegion(app);
  });
  box.appendChild(toggle);

  /* calendar availability notice (AC10.2's graceful degradation) */
  var notice = document.createElement("p");
  notice.style.cssText =
    "margin:0;font-size:10px;border-radius:8px;padding:4px 8px;" +
    (panelState.calendarNotice
      ? "background:rgba(251,191,36,.12);color:#fbbf24;"
      : "background:rgba(52,211,153,.1);color:#34d399;");
  notice.textContent = panelState.calendarNotice || T("calendarOn");
  box.appendChild(notice);

  /* ---- goals ---- */
  var goalsHeader = document.createElement("p");
  goalsHeader.textContent = T("goals");
  goalsHeader.style.cssText = "margin:0;font-weight:700;";
  box.appendChild(goalsHeader);
  if (state.goals.length === 0) {
    var noGoals = document.createElement("p");
    noGoals.textContent = T("noGoals");
    noGoals.style.cssText = "margin:0;opacity:.6;font-size:11px;";
    box.appendChild(noGoals);
  }
  state.goals.forEach(function (goal) {
    var row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;gap:6px;background:rgba(15,23,42,.5);" +
      "border-radius:8px;padding:4px 8px;margin-bottom:3px;";
    var icon = document.createElement("span");
    icon.textContent = goal.kind === "long" ? "🎯" : "⚡";
    var text = document.createElement("span");
    text.style.cssText = "flex:1;font-size:11px;";
    text.textContent = goal.title;
    var del = document.createElement("button");
    del.type = "button";
    del.textContent = "🗑";
    del.style.cssText = "background:none;border:none;cursor:pointer;color:#f87171;";
    del.addEventListener("click", function () {
      if (window.confirm(T("deleteConfirm"))) {
        app.datahub
          .query({ contractId: "planner.tasks", versionRange: "^1", method: "deleteGoal", params: { id: goal.id } })
          .then(function () { renderRegion(app); });
      }
    });
    row.appendChild(icon);
    row.appendChild(text);
    row.appendChild(del);
    box.appendChild(row);
  });
  var goalForm = document.createElement("div");
  goalForm.style.cssText = "display:flex;gap:4px;";
  var goalInput = document.createElement("input");
  goalInput.type = "text";
  goalInput.placeholder = T("goalTitle");
  goalInput.style.cssText = INPUT_STYLE + "flex:1;";
  var goalKind = document.createElement("select");
  goalKind.style.cssText = INPUT_STYLE;
  [
    { v: "short", l: T("shortTerm") },
    { v: "long", l: T("longTerm") }
  ].forEach(function (option) {
    var el = document.createElement("option");
    el.value = option.v;
    el.textContent = option.l;
    goalKind.appendChild(el);
  });
  var goalAdd = document.createElement("button");
  goalAdd.type = "button";
  goalAdd.textContent = T("addGoal");
  goalAdd.style.cssText = BUTTON_STYLE;
  goalAdd.addEventListener("click", function () {
    var title = goalInput.value.trim();
    if (!title) { goalInput.focus(); return; }
    app.datahub
      .query({
        contractId: "planner.tasks",
        versionRange: "^1",
        method: "addGoal",
        params: { title: title, kind: goalKind.value }
      })
      .then(function () { renderRegion(app); });
  });
  goalForm.appendChild(goalInput);
  goalForm.appendChild(goalKind);
  goalForm.appendChild(goalAdd);
  box.appendChild(goalForm);

  /* ---- tasks ---- */
  var tasksHeader = document.createElement("p");
  tasksHeader.textContent = T("tasks");
  tasksHeader.style.cssText = "margin:4px 0 0;font-weight:700;";
  box.appendChild(tasksHeader);
  if (state.tasks.length === 0) {
    var noTasks = document.createElement("p");
    noTasks.textContent = T("noTasks");
    noTasks.style.cssText = "margin:0;opacity:.6;font-size:11px;";
    box.appendChild(noTasks);
  }
  var today = todayJalali();
  state.tasks.forEach(function (task) {
    var row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;gap:6px;background:rgba(15,23,42,.5);" +
      "border-radius:8px;padding:4px 8px;margin-bottom:3px;" +
      (task.status === "done" ? "opacity:.65;" : "");
    var check = document.createElement("button");
    check.type = "button";
    check.textContent = task.status === "done" ? "✓" : "";
    check.style.cssText =
      "width:16px;height:16px;border-radius:4px;cursor:pointer;flex-shrink:0;" +
      "border:1.5px solid rgba(148,163,184,.6);font-size:10px;color:inherit;background:" +
      (task.status === "done" ? "#34d399;color:#0f172a;" : "transparent;");
    check.title = task.status === "done" ? T("reopen") : T("complete");
    check.addEventListener("click", function () {
      app.datahub
        .query({
          contractId: "planner.tasks",
          versionRange: "^1",
          method: task.status === "done" ? "reopenTask" : "completeTask",
          params: { id: task.id }
        })
        .then(function () { renderRegion(app); });
    });
    var text = document.createElement("span");
    text.style.cssText = "flex:1;font-size:11px;";
    var overdue =
      task.status === "pending" && task.due && dateLess(task.due, today);
    text.textContent = task.title;
    if (overdue) { text.style.color = "#f87171"; }
    var dueLabel = document.createElement("span");
    dueLabel.style.cssText = "font-size:9px;opacity:.7;";
    dueLabel.textContent = task.due
      ? task.due.jy + "/" + task.due.jm + "/" + task.due.jd
      : "—";
    var del = document.createElement("button");
    del.type = "button";
    del.textContent = "🗑";
    del.style.cssText = "background:none;border:none;cursor:pointer;color:#f87171;";
    del.addEventListener("click", function () {
      if (window.confirm(T("deleteConfirm"))) {
        app.datahub
          .query({ contractId: "planner.tasks", versionRange: "^1", method: "deleteTask", params: { id: task.id } })
          .then(function () { renderRegion(app); });
      }
    });
    row.appendChild(check);
    row.appendChild(text);
    row.appendChild(dueLabel);
    row.appendChild(del);
    box.appendChild(row);
  });

  /* add-task form with the calendar-powered due picker */
  var taskForm = document.createElement("div");
  taskForm.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  var taskInput = document.createElement("input");
  taskInput.type = "text";
  taskInput.placeholder = T("taskTitle");
  taskInput.style.cssText = INPUT_STYLE;
  var goalSelect = document.createElement("select");
  goalSelect.style.cssText = INPUT_STYLE;
  var noGoalOption = document.createElement("option");
  noGoalOption.value = "";
  noGoalOption.textContent = T("noGoal");
  goalSelect.appendChild(noGoalOption);
  state.goals.forEach(function (goal) {
    var option = document.createElement("option");
    option.value = goal.id;
    option.textContent = goal.title;
    goalSelect.appendChild(option);
  });

  var dueRow = document.createElement("div");
  dueRow.style.cssText = "display:flex;gap:4px;align-items:center;";
  var dueInput = document.createElement("input");
  dueInput.type = "text";
  dueInput.placeholder = T("manualDate");
  dueInput.style.cssText = INPUT_STYLE + "flex:1;direction:ltr;";
  var pickerButton = document.createElement("button");
  pickerButton.type = "button";
  pickerButton.textContent = "🗓";
  pickerButton.title = T("pickDate");
  pickerButton.style.cssText = BUTTON_STYLE;
  pickerButton.addEventListener("click", function () {
    panelState.pickerOpen = !panelState.pickerOpen;
    if (panelState.pickerOpen && panelState.pickerJy === null) {
      var t = todayJalali();
      panelState.pickerJy = t.jy;
      panelState.pickerJm = t.jm;
    }
    drawPicker(app, dueInput, state);
  });
  dueRow.appendChild(dueInput);
  dueRow.appendChild(pickerButton);

  var taskAdd = document.createElement("button");
  taskAdd.type = "button";
  taskAdd.textContent = T("addTask");
  taskAdd.style.cssText =
    "padding:6px;border-radius:8px;cursor:pointer;font:inherit;" +
    "border:1px solid rgba(52,211,153,.4);background:rgba(52,211,153,.18);color:#e7e5e4;";
  taskAdd.addEventListener("click", function () {
    var title = taskInput.value.trim();
    if (!title) { taskInput.focus(); return; }
    var due = null;
    var raw = dueInput.value.trim();
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(raw)) {
      var parts = raw.split("/");
      due = { jy: Number(parts[0]), jm: Number(parts[1]), jd: Number(parts[2]) };
    }
    app.datahub
      .query({
        contractId: "planner.tasks",
        versionRange: "^1",
        method: "addTask",
        params: {
          title: title,
          goalId: goalSelect.value || null,
          due: due
        }
      })
      .then(function () { renderRegion(app); });
  });
  taskForm.appendChild(taskInput);
  taskForm.appendChild(goalSelect);
  taskForm.appendChild(dueRow);
  taskForm.appendChild(taskAdd);

  var pickerHost = document.createElement("div");
  pickerHost.id = "picker-host";
  taskForm.appendChild(pickerHost);

  box.appendChild(taskForm);
  document.body.appendChild(box);

  /* probe the calendar contract once per render (AC10.2 notice) */
  app.datahub
    .query({ contractId: "calendar.events", versionRange: "^1", method: "monthInfo", params: { jy: today.jy, jm: today.jm } })
    .then(function (outcome) {
      if (outcome && outcome.ok) {
        panelState.calendarNotice = null;
      } else {
        panelState.calendarNotice =
          (outcome && outcome.message) || T("calendarUnavailable");
      }
      notice.textContent = panelState.calendarNotice || T("calendarOn");
      notice.style.cssText =
        "margin:0;font-size:10px;border-radius:8px;padding:4px 8px;" +
        (panelState.calendarNotice
          ? "background:rgba(251,191,36,.12);color:#fbbf24;"
          : "background:rgba(52,211,153,.1);color:#34d399;");
    });
}

/** The calendar-powered date picker (AC10.2: planner uses calendar dates). */
function drawPicker(app, dueInput) {
  var host = document.getElementById("picker-host");
  if (host === null) { return; }
  host.innerHTML = "";
  if (!panelState.pickerOpen) { return; }
  app.datahub
    .query({
      contractId: "calendar.events",
      versionRange: "^1",
      method: "monthInfo",
      params: { jy: panelState.pickerJy, jm: panelState.pickerJm }
    })
    .then(function (outcome) {
      if (host === null) { return; }
      if (!outcome || !outcome.ok) {
        panelState.calendarNotice =
          (outcome && outcome.message) || T("calendarUnavailable");
        var fallback = document.createElement("p");
        fallback.textContent = T("calendarUnavailable");
        fallback.style.cssText =
          "margin:0;font-size:10px;color:#fbbf24;background:rgba(251,191,36,.1);" +
          "border-radius:8px;padding:6px;";
        host.appendChild(fallback);
        return;
      }
      var info = outcome.result;
      var grid = document.createElement("div");
      grid.style.cssText =
        "display:grid;grid-template-columns:repeat(7,1fr);gap:2px;direction:rtl;";
      ["ش", "ی", "د", "س", "چ", "پ", "ج"].forEach(function (h) {
        var head = document.createElement("div");
        head.textContent = h;
        head.style.cssText = "text-align:center;font-size:9px;opacity:.6;";
        grid.appendChild(head);
      });
      for (var blank = 0; blank < info.firstWeekday; blank += 1) {
        grid.appendChild(document.createElement("div"));
      }
      var holidayDays = {};
      (info.holidays || []).forEach(function (holiday) {
        holidayDays[holiday.day] = holiday.title;
      });
      var eventDays = {};
      (info.events || []).forEach(function (event) {
        eventDays[event.day] = true;
      });
      var _pick = function (day) {
        var cell = document.createElement("div");
        cell.textContent = String(day);
        cell.style.cssText =
          "aspect-ratio:1.2;display:flex;align-items:center;justify-content:center;" +
          "border-radius:6px;cursor:pointer;font-size:10px;" +
          "background:rgba(15,23,42,.5);" +
          (holidayDays[day] ? "color:#f87171;" : "") +
          (eventDays[day] ? "border:1px solid rgba(56,189,248,.5);" : "");
        if (holidayDays[day]) { cell.title = holidayDays[day]; }
        cell.addEventListener("click", function () {
          dueInput.value =
            panelState.pickerJy + "/" + panelState.pickerJm + "/" + day;
          panelState.pickerOpen = false;
          host.innerHTML = "";
        });
        grid.appendChild(cell);
      };
      for (var day = 1; day <= info.length; day += 1) {
        _pick(day);
      }
      var nav = document.createElement("div");
      nav.style.cssText = "display:flex;gap:4px;align-items:center;margin-bottom:4px;";
      var prev = document.createElement("button");
      prev.type = "button";
      prev.textContent = "→";
      prev.style.cssText = BUTTON_STYLE;
      prev.title = T("prev");
      prev.addEventListener("click", function () {
        shiftPicker(-1);
        drawPicker(app, dueInput);
      });
      var label = document.createElement("span");
      label.style.cssText = "flex:1;text-align:center;font-weight:700;font-size:11px;";
      label.textContent = info.monthName + " " + info.year;
      var next = document.createElement("button");
      next.type = "button";
      next.textContent = "←";
      next.style.cssText = BUTTON_STYLE;
      next.title = T("next");
      next.addEventListener("click", function () {
        shiftPicker(1);
        drawPicker(app, dueInput);
      });
      nav.appendChild(prev);
      nav.appendChild(label);
      nav.appendChild(next);
      host.appendChild(nav);
      host.appendChild(grid);
    });
}

function shiftPicker(delta) {
  var jm = panelState.pickerJm + delta;
  var jy = panelState.pickerJy;
  if (jm > 12) { jm = 1; jy += 1; }
  if (jm < 1) { jm = 12; jy -= 1; }
  panelState.pickerJm = jm;
  panelState.pickerJy = jy;
}

var BUTTON_STYLE =
  "padding:4px 8px;border-radius:8px;cursor:pointer;font:inherit;" +
  "border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.55);color:#e7e5e4;";
var INPUT_STYLE =
  "padding:5px 8px;border-radius:8px;font:inherit;color:#e7e5e4;" +
  "border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.55);outline:none;";
