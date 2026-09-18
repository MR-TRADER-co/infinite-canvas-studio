/**
 * AI Analyst — the first-party analysis plugin (R10.6).
 *
 * Network permission is OPT-IN at install (the consent dialog lists it
 * in plain Persian). Two backends:
 * - EXTERNAL: an OpenAI-compatible /chat/completions endpoint with the
 *   USER'S OWN key (stored only inside this plugin's storage);
 * - LOCAL: an Ollama-compatible /api/chat endpoint (no key needed).
 *
 * Consumes `project.digest` (+ opt-in `planner.tasks`) to analyse the
 * day/week/month journal material. BEFORE ANY network call the panel
 * shows the transparent «این داده‌ها دقیقاً ارسال خواهد شد» preview of
 * the EXACT request payload; only the explicit «تأیید و ارسال» (or the
 * equivalent region message {type: "confirm-send"}) releases it
 * (AC10.5). Without a key/endpoint the plugin degrades to a Persian
 * notice — the app is unaffected.
 *
 * Flow (cross-sandbox via storage): the headless command
 * `prepare` builds the payload and persists it ("pendingRequest");
 * the panel region renders the preview from that pending payload and
 * sends it on confirm; the response lands in "lastReport".
 */

/* eslint-disable */
var LANG = "fa";
var DICT = {
  fa: {
    panelTitle: "تحلیلگر هوش",
    backend: "پشتیبان", external: "API بیرونی", local: "Ollamaٔ محلی",
    endpoint: "نشانی سرویس", apiKey: "کلید API", model: "نام مدل",
    saved: "ذخیره شد.",
    day: "روزانه", week: "هفتگی", monthly: "ماهانه",
    analyze: "تحلیل", includePlanner: "شامل کارهای برنامه‌ریز",
    previewTitle: "این داده‌ها دقیقاً ارسال خواهد شد:",
    confirmSend: "تأیید و ارسال", cancel: "لغو",
    noConfig: "نشانی و کلید/مدل تنظیم نشده است.",
    pending: "درخواست آماده است؛ برای ارسال تأیید کنید.",
    sending: "در حال ارسال…",
    reportTitle: "گزارش تحلیل", reportSaved: "گزارش ذخیره شد.",
    error: "خطا در ارتباط با سرویس.",
    keyHint: "کلید فقط در فضای این افزونه ذخیره می‌شود.",
    digestMissing: "خلاصهٔ پروژه در دسترس نیست.",
    plannerMissing: "دادگان برنامه‌ریز در دسترس نیست (اختیاری).",
    journalTitle: "ژورنال روزانه",
    journalNotice: "دادگان یادداشت روزانه در دسترس نیست (افزونهٔ آن را نصب کنید).",
    journalEmpty: "در این بازه یادداشتی نیست.",
    journalEntries: "یادداشت",
    journalWords: "واژه",
    journalAvg: "میانگین واژه در روز",
    journalBest: "پرکارترین روز",
    journalStreak: "زنجیرهٔ پیوسته"
  },
  en: {
    panelTitle: "AI Analyst",
    backend: "Backend", external: "External API", local: "Local Ollama",
    endpoint: "Service URL", apiKey: "API key", model: "Model name",
    saved: "Saved.",
    day: "Daily", week: "Weekly", monthly: "Monthly",
    analyze: "Analyse", includePlanner: "Include planner tasks",
    previewTitle: "Exactly this data will be sent:",
    confirmSend: "Confirm & send", cancel: "Cancel",
    noConfig: "URL and key/model are not configured.",
    pending: "Request is ready; confirm to send.",
    sending: "Sending…",
    reportTitle: "Analysis report", reportSaved: "Report saved.",
    error: "Service communication failed.",
    keyHint: "The key is stored only in this plugin's own space.",
    digestMissing: "Project digest unavailable.",
    plannerMissing: "Planner data unavailable (optional).",
    journalTitle: "Daily journal",
    journalNotice: "Daily-notes data unavailable (install the Daily Notes plugin).",
    journalEmpty: "No notes in this range.",
    journalEntries: "notes",
    journalWords: "words",
    journalAvg: "avg words/day",
    journalBest: "Most productive day",
    journalStreak: "Streak"
  }
};
function T(key) {
  return (DICT[LANG] && DICT[LANG][key]) || (DICT.fa[key] || key);
}

var CONFIG_KEY = "config";
var PENDING_KEY = "pendingRequest";
var LAST_REPORT_KEY = "lastReport";

var DEFAULT_CONFIG = {
  backend: "external",
  endpoint: "",
  apiKey: "",
  model: ""
};

function readConfig(app) {
  return app.storage.get(CONFIG_KEY).then(function (value) {
    if (value && typeof value === "object") {
      return {
        backend: value.backend === "local" ? "local" : "external",
        endpoint: typeof value.endpoint === "string" ? value.endpoint : "",
        apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
        model: typeof value.model === "string" ? value.model : ""
      };
    }
    return DEFAULT_CONFIG;
  });
}

/** Gathers the digest (+ opt-in planner tasks) for one period. */
function gatherMaterial(app, period, includePlanner) {
  return app.datahub
    .query({ contractId: "project.digest", versionRange: "^1", method: "get", params: {} })
    .then(function (digestOutcome) {
      var digest =
        digestOutcome && digestOutcome.ok ? digestOutcome.result : null;
      return queryJournal(app, period).then(function (journal) {
        if (!includePlanner) {
          return {
            digest: digest,
            tasks: null,
            plannerNotice: false,
            journal: journal
          };
        }
        return app.datahub
          .query({
            contractId: "planner.tasks",
            versionRange: "^1",
            method: "queryTasks",
            params: {}
          })
          .then(function (plannerOutcome) {
            var tasks =
              plannerOutcome && plannerOutcome.ok
                ? ((plannerOutcome.result && plannerOutcome.result.tasks) || [])
                : null;
            return {
              digest: digest,
              tasks: tasks,
              plannerNotice: tasks === null,
              journal: journal
            };
          });
      });
    });
}

/**
 * Pack-14 R14.3: the structured journal source — dailies.entries v1,
 * range-matched to the analysis period, degraded to null when the
 * dailynotes plugin is absent (a notice, never a failure).
 */
function queryJournal(app, period) {
  var days = period === "day" ? 1 : period === "week" ? 7 : 30;
  var from = new Date();
  from.setDate(from.getDate() - (days - 1));
  var fromISO =
    from.getFullYear() + "-" +
    (from.getMonth() + 1 < 10 ? "0" : "") + (from.getMonth() + 1) + "-" +
    (from.getDate() < 10 ? "0" : "") + from.getDate();
  return app.datahub
    .query({
      contractId: "dailynotes.entries",
      versionRange: "^1",
      method: "getEntries",
      params: { from: fromISO }
    })
    .then(function (outcome) {
      if (!outcome || !outcome.ok) {
        return null;
      }
      return (outcome.result && outcome.result.entries) || [];
    })
    .catch(function () { return null; });
}

/** Builds the EXACT request payload (the preview shows it verbatim). */
function buildPayload(config, period, material) {
  var prompt =
    "تو دستیار تحلیل روزنامهٔ کاری هستی. گزارشی ساخت‌یافته و کوتاه به فارسی " +
    "بده با این بخش‌ها: ۱) خلاصهٔ وضعیت ۲) نکات برجسته ۳) ریسک‌ها/عقب‌افتادگی‌ها " +
    "۴) سه پیشنهاد عملی برای دورهٔ " +
    (period === "day" ? "امروز" : period === "week" ? "این هفته" : "این ماه") +
    ". پاسخ را فقط به فارسی و به شکل متن ساخت‌یافته بده.";
  var content = {
    period: period,
    project: material.digest,
    plannerTasks: material.tasks === null ? undefined : material.tasks,
    journal: material.journal === null ? undefined : material.journal
  };
  var body = {
    period: period,
    prompt: prompt,
    context: content
  };
  if (config.backend === "local") {
    return {
      kind: "ollama",
      url: config.endpoint.replace(/\/+$/, "") + "/api/chat",
      body: {
        model: config.model || "llama3",
        stream: false,
        messages: [
          { role: "user", content: JSON.stringify(body) }
        ]
      }
    };
  }
  return {
    kind: "openai",
    url: config.endpoint.replace(/\/+$/, "") + "/chat/completions",
    headers: { Authorization: "Bearer " + config.apiKey },
    body: {
      model: config.model || "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify(content) }
      ]
    }
  };
}

/** Extracts the model's text from either backend's response. */
function extractText(kind, responseBodyText) {
  var parsed = null;
  try { parsed = JSON.parse(responseBodyText); } catch (e) { parsed = null; }
  if (parsed === null) { return responseBodyText.slice(0, 4000); }
  if (kind === "ollama") {
    return (parsed.message && parsed.message.content) || parsed.response || "";
  }
  if (Array.isArray(parsed.choices) && parsed.choices[0]) {
    var message = parsed.choices[0].message;
    return (message && message.content) || "";
  }
  return "";
}

/** The network call itself — only EVER called from confirmSend. */
function dispatchRequest(app, payload) {
  var init = {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  };
  if (payload.headers) {
    Object.keys(payload.headers).forEach(function (key) {
      init.headers[key] = payload.headers[key];
    });
  }
  init.body = JSON.stringify(payload.body);
  return app.network.fetch(payload.url, init).then(function (response) {
    if (response.status < 200 || response.status >= 300) {
      throw new Error("HTTP " + response.status);
    }
    return extractText(payload.kind, response.bodyText);
  });
}

function pluginMain(app) {
  if (app.region) {
    /* The confirm gate also accepts host-driven confirmations (tests +
     * future host surfaces) — registered BEFORE any DOM work so the
     * gate also works in DOM-less region harnesses. */
    app.region.onMessage(function (message) {
      if (message && message.type === "confirm-send") {
        confirmSend(app);
      }
      if (message && message.type === "cancel-send") {
        app.storage.delete(PENDING_KEY).then(function () { renderRegion(app); });
      }
    });
    if (typeof document === "undefined") {
      /* DOM-less region harness (unit tests): the gate is live, the
       * rendering is not. */
      return;
    }
    renderRegion(app);
    app.events.on("ui:language-changed", function (payload) {
      LANG = payload && payload.language === "en" ? "en" : "fa";
      renderRegion(app);
    });
    return;
  }

  /* ---- headless: prepare command + the panel ---- */
  app.commands.register({
    id: "prepare",
    titleKey: "ai-analyst:command.prepare",
    icon: "Sparkles",
    execute: function () {
      readConfig(app).then(function (config) {
        return gatherMaterial(app, "day", true).then(function (material) {
          var payload = buildPayload(config, "day", material);
          return app.storage.set(PENDING_KEY, {
            period: "day",
            createdAt: Date.now(),
            payload: payload
          });
        });
      });
    }
  });

  app.panels.register({
    id: "main",
    titleKey: "ai-analyst:panel.title",
    icon: "Sparkles",
    placement: "right",
    order: 330
  });

  app.settings.register({
    id: "backend",
    titleKey: "ai-analyst:settings.title",
    order: 330
  });
}

/* ---- the panel + settings regions ---- */

var panelState = { period: "day", includePlanner: false, status: null };

function renderRegion(app) {
  if (typeof document === "undefined") {
    /* DOM-less harness: state changes only (the gate stays live). */
    return;
  }
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
  var form = document.createElement("div");
  form.style.cssText = "display:flex;flex-direction:column;gap:6px;";

  var backendRow = document.createElement("div");
  backendRow.style.cssText = "display:flex;gap:4px;";
  ["external", "local"].forEach(function (backend) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = T(backend);
    button.style.cssText =
      "flex:1;padding:5px;border-radius:8px;cursor:pointer;font:inherit;" +
      "border:1px solid rgba(148,163,184,.35);color:#e7e5e4;background:rgba(15,23,42,.55);";
    button.addEventListener("click", function () {
      readConfig(app).then(function (config) {
        config.backend = backend;
        return app.storage.set(CONFIG_KEY, config);
      }).then(function () { renderSettingsRegion(app); });
    });
    backendRow.appendChild(button);
  });
  form.appendChild(backendRow);

  var fields = {};
  function addField(key, type, placeholder, hint) {
    var label = document.createElement("p");
    label.style.cssText = "margin:0;font-size:10px;opacity:.75;";
    label.textContent = T(key);
    form.appendChild(label);
    var input = document.createElement("input");
    input.type = type;
    input.placeholder = placeholder || "";
    input.style.cssText =
      "padding:5px 8px;border-radius:8px;font:inherit;color:#e7e5e4;" +
      "border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.55);outline:none;";
    form.appendChild(input);
    fields[key] = input;
    if (hint) {
      var note = document.createElement("p");
      note.style.cssText = "margin:0 0 4px;font-size:9px;opacity:.6;";
      note.textContent = hint;
      form.appendChild(note);
    }
  }
  addField("endpoint", "text", "https://api.example.com/v1");
  addField("apiKey", "password", "sk-…", T("keyHint"));
  addField("model", "text", "gpt-4o-mini / llama3");

  var save = document.createElement("button");
  save.type = "button";
  save.textContent = T("saved") === "Saved." ? "Save" : "ذخیره";
  save.style.cssText =
    "padding:6px;border-radius:8px;cursor:pointer;font:inherit;" +
    "border:1px solid rgba(244,114,182,.4);background:rgba(244,114,182,.2);color:#e7e5e4;";
  save.addEventListener("click", function () {
    readConfig(app).then(function (config) {
      config.endpoint = fields.endpoint.value.trim();
      config.apiKey = fields.apiKey.value.trim();
      config.model = fields.model.value.trim();
      return app.storage.set(CONFIG_KEY, config);
    });
  });
  form.appendChild(save);

  readConfig(app).then(function (config) {
    fields.endpoint.value = config.endpoint;
    fields.apiKey.value = config.apiKey;
    fields.model.value = config.model;
  });

  document.body.appendChild(form);
}

function renderPanelRegion(app) {
  if (typeof document === "undefined") {
    /* DOM-less harness: state changes only (the gate stays live). */
    return;
  }
  var box = document.createElement("div");
  box.style.cssText = "display:flex;flex-direction:column;gap:8px;";

  /* period + options */
  var periods = document.createElement("div");
  periods.style.cssText = "display:flex;gap:4px;";
  ["day", "week", "monthly"].forEach(function (period) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = T(period);
    button.style.cssText =
      "flex:1;padding:4px;border-radius:8px;cursor:pointer;font:inherit;" +
      "border:1px solid rgba(148,163,184,.35);color:#e7e5e4;" +
      (panelState.period === period
        ? "background:rgba(244,114,182,.3);"
        : "background:rgba(15,23,42,.55);");
    button.addEventListener("click", function () {
      panelState.period = period;
      renderPanelRegion(app);
    });
    periods.appendChild(button);
  });
  box.appendChild(periods);

  var plannerCheck = document.createElement("label");
  plannerCheck.style.cssText =
    "display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;";
  var checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = panelState.includePlanner;
  checkbox.addEventListener("change", function () {
    panelState.includePlanner = checkbox.checked;
  });
  plannerCheck.appendChild(checkbox);
  plannerCheck.appendChild(document.createTextNode(T("includePlanner")));
  box.appendChild(plannerCheck);

  var analyze = document.createElement("button");
  analyze.type = "button";
  analyze.textContent = T("analyze");
  analyze.style.cssText =
    "padding:7px;border-radius:10px;cursor:pointer;font:inherit;font-weight:600;" +
    "border:1px solid rgba(244,114,182,.45);background:rgba(244,114,182,.25);color:#fda4af;";
  analyze.addEventListener("click", function () {
    panelState.status = "building";
    readConfig(app).then(function (config) {
      if (config.endpoint === "") {
        panelState.status = "no-config";
        renderPanelRegion(app);
        return;
      }
      return gatherMaterial(app, panelState.period, panelState.includePlanner)
        .then(function (material) {
          var payload = buildPayload(config, panelState.period, material);
          /* AC10.5: the payload PERSISTS as pending; NOTHING is sent
           * until the explicit confirmation below. */
          return app.storage.set(PENDING_KEY, {
            period: panelState.period,
            createdAt: Date.now(),
            payload: payload
          });
        })
        .then(function () {
          panelState.status = "pending";
          renderPanelRegion(app);
        });
    });
  });
  box.appendChild(analyze);

  /* R14.3: the LOCAL journal summary — Persian stats over
   * dailies.entries, visible without any network backend. */
  appendJournalSummary(app, box, panelState.period);

  document.body.appendChild(box);

  /* status + preview + last report */
  if (panelState.status === "no-config") {
    appendNotice(box, T("noConfig"), "#fbbf24");
  }
  if (panelState.status === "sending") {
    appendNotice(box, T("sending"), "#38bdf8");
  }

  app.storage.get(PENDING_KEY).then(function (pending) {
    if (pending && pending.payload) {
      appendPendingPreview(app, box, pending);
    }
    app.storage.get(LAST_REPORT_KEY).then(function (report) {
      if (report && report.text) {
        appendReport(box, report);
      }
    });
  });
}

function appendNotice(box, text, colour) {
  var note = document.createElement("p");
  note.textContent = text;
  note.style.cssText =
    "margin:0;font-size:10px;color:" + colour + ";background:rgba(" +
    (colour === "#fbbf24" ? "251,191,36,.1" : "56,189,248,.1") +
    ");border-radius:8px;padding:4px 8px;";
  box.appendChild(note);
}

/**
 * The local journal summary (R14.3): entries, total/avg words, the
 * most productive day and the current streak — all from
 * dailies.entries, all OFFLINE. Degrades to a quiet notice when the
 * dailynotes plugin is absent.
 */
function appendJournalSummary(app, box, period) {
  queryJournal(app, period).then(function (entries) {
    var frame = document.createElement("div");
    frame.style.cssText =
      "margin-top:10px;border:1px solid rgba(45,212,191,.3);border-radius:10px;" +
      "padding:8px;background:rgba(45,212,191,.07);";
    var title = document.createElement("p");
    title.textContent =
      T("journalTitle") +
      " (" +
      T(period === "day" ? "day" : period === "week" ? "week" : "monthly") +
      ")";
    title.style.cssText = "margin:0 0 5px;font-weight:700;font-size:11px;color:#5eead4;";
    frame.appendChild(title);

    if (entries === null) {
      var notice = document.createElement("p");
      notice.textContent = T("journalNotice");
      notice.style.cssText = "margin:0;font-size:10px;color:#a8a29e;";
      frame.appendChild(notice);
      box.appendChild(frame);
      return;
    }
    if (entries.length === 0) {
      var empty = document.createElement("p");
      empty.textContent = T("journalEmpty");
      empty.style.cssText = "margin:0;font-size:10px;color:#a8a29e;";
      frame.appendChild(empty);
      box.appendChild(frame);
      return;
    }

    var totalWords = 0;
    var best = entries[0];
    for (var i = 0; i < entries.length; i += 1) {
      totalWords += entries[i].wordCount || 0;
      if ((entries[i].wordCount || 0) > (best.wordCount || 0)) {
        best = entries[i];
      }
    }
    /* streak: consecutive days ending at the LATEST entry */
    var streak = 1;
    for (var k = entries.length - 1; k > 0; k -= 1) {
      var prev = new Date(entries[k - 1].dateISO + "T00:00:00");
      var curr = new Date(entries[k].dateISO + "T00:00:00");
      var diffDays = Math.round((curr - prev) / 86400000);
      if (diffDays === 1) { streak += 1; } else { break; }
    }

    var rows = [
      [T("journalEntries"), faNum(entries.length)],
      [T("journalWords"), faNum(totalWords)],
      [T("journalAvg"), faNum(Math.round(totalWords / Math.max(1, entries.length)))],
      [T("journalBest"), (best.title || best.dateISO) + " · " + faNum(best.wordCount || 0)],
      [T("journalStreak"), faNum(streak)]
    ];
    rows.forEach(function (pair) {
      var row = document.createElement("div");
      row.style.cssText =
        "display:flex;justify-content:space-between;gap:8px;font-size:10.5px;" +
        "padding:2px 0;color:#d6d3d1;";
      var k = document.createElement("span");
      k.style.cssText = "color:#a8a29e;";
      k.textContent = pair[0];
      var v = document.createElement("span");
      v.style.cssText = "font-weight:600;white-space:nowrap;overflow:hidden;" +
        "text-overflow:ellipsis;max-width:60%;";
      v.textContent = pair[1];
      row.appendChild(k);
      row.appendChild(v);
      frame.appendChild(row);
    });
    box.appendChild(frame);
  });
}

function faNum(n) {
  return String(n).replace(/[0-9]/g, function (d) {
    return "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d));
  });
}

/** The transparent preview + confirm/cancel (AC10.5's core surface). */
function appendPendingPreview(app, box, pending) {
  var frame = document.createElement("div");
  frame.style.cssText =
    "border:1px solid rgba(244,114,182,.4);border-radius:10px;padding:8px;" +
    "background:rgba(244,114,182,.08);";
  var title = document.createElement("p");
  title.style.cssText = "margin:0 0 4px;font-weight:700;font-size:11px;color:#f9a8d4;";
  title.textContent = "🔎 " + T("previewTitle");
  frame.appendChild(title);
  var preview = document.createElement("pre");
  preview.style.cssText =
    "margin:0 0 6px;max-height:140px;overflow:auto;font-size:9px;direction:ltr;" +
    "white-space:pre-wrap;background:rgba(2,6,23,.7);border-radius:8px;padding:6px;color:#cbd5e1;";
  preview.textContent = JSON.stringify(pending.payload, null, 2);
  frame.appendChild(preview);

  var actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:4px;";
  var confirm = document.createElement("button");
  confirm.type = "button";
  confirm.textContent = T("confirmSend");
  confirm.style.cssText =
    "flex:1;padding:5px;border-radius:8px;cursor:pointer;font:inherit;" +
    "border:1px solid rgba(52,211,153,.5);background:rgba(52,211,153,.2);color:#6ee7b7;";
  confirm.addEventListener("click", function () {
    confirmSend(app);
  });
  var cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = T("cancel");
  cancel.style.cssText =
    "flex:1;padding:5px;border-radius:8px;cursor:pointer;font:inherit;" +
    "border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.55);color:#e7e5e4;";
  cancel.addEventListener("click", function () {
    app.storage.delete(PENDING_KEY).then(function () {
      panelState.status = null;
      renderPanelRegion(app);
    });
  });
  actions.appendChild(confirm);
  actions.appendChild(cancel);
  frame.appendChild(actions);
  box.appendChild(frame);
}

/** Sends the pending payload (the ONLY path to the network). */
function confirmSend(app) {
  app.storage.get(PENDING_KEY).then(function (pending) {
    if (pending === null || pending === undefined || !pending.payload) {
      return;
    }
    panelState.status = "sending";
    renderPanelRegion(app);
    dispatchRequest(app, pending.payload)
      .then(function (text) {
        var report = {
          period: pending.period,
          at: Date.now(),
          text: text,
          request: pending.payload
        };
        return app.storage
          .set(LAST_REPORT_KEY, report)
          .then(function () { return app.storage.delete(PENDING_KEY); })
          .then(function () {
            panelState.status = "sent";
            renderPanelRegion(app);
          });
      })
      .catch(function () {
        panelState.status = "error";
        renderPanelRegion(app);
      });
  });
}

function appendReport(box, report) {
  var frame = document.createElement("div");
  frame.style.cssText =
    "border:1px solid rgba(148,163,184,.35);border-radius:10px;padding:8px;" +
    "background:rgba(15,23,42,.5);";
  var title = document.createElement("p");
  title.style.cssText = "margin:0 0 4px;font-weight:700;font-size:11px;";
  title.textContent = "📄 " + T("reportTitle") + " (" + report.period + ")";
  frame.appendChild(title);
  var text = document.createElement("div");
  text.style.cssText =
    "font-size:11px;line-height:1.8;white-space:pre-wrap;";
  text.textContent = report.text || "—";
  frame.appendChild(text);
  var stamp = document.createElement("p");
  stamp.style.cssText = "margin:4px 0 0;font-size:9px;opacity:.6;direction:ltr;";
  stamp.textContent = new Date(report.at || Date.now()).toISOString();
  frame.appendChild(stamp);
  box.appendChild(frame);
}
