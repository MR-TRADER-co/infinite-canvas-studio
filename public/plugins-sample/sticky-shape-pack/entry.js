/**
 * Sticky Shape Pack — the official sample plugin (R9.7).
 *
 * Exercises every SDK surface end-to-end:
 * - app.objects.register × 3 (catalog metadata + factories + widget
 *   renderers) → the Insert Panel shows the cards automatically;
 * - app.commands.register × 1 (insert a star; toolbar + palette);
 * - app.panels.register × 1 (an insert panel body);
 * - app.settings.register × 1 (default colour);
 * - app.storage (the colour persists);
 * - app.events (language changes re-render the regions).
 *
 * Headless mode (no app.region): registrations only.
 * Region mode (app.region): renders the panel body or the settings
 * section — the region id decides which.
 */

/* eslint-disable */
var LANG = "fa";
var DICT = {
  fa: {
    star: "ستارهٔ یادداشتی",
    heart: "قلب یادداشتی",
    burst: "شکوفهٔ یادداشتی",
    insertHint: "برای درج روی هر شکل کلیک کنید:",
    created: "ساخته شد!",
    color: "رنگ پیش‌فرض",
    saved: "ذخیره شد.",
    description: "رنگ پیش‌فرض ستاره‌ها و قلب‌ها؛ فقط برای اشیاء تازه اعمال می‌شود."
  },
  en: {
    star: "Sticky star",
    heart: "Sticky heart",
    burst: "Sticky burst",
    insertHint: "Click a shape to insert it:",
    created: "Created!",
    color: "Default colour",
    saved: "Saved.",
    description: "Default colour for new stars and hearts; applies to new shapes only."
  }
};
function T(key) {
  return (DICT[LANG] && DICT[LANG][key]) || (DICT.fa[key] || key);
}

var COLOR_KEY = "defaultColor";
var DEFAULT_COLOR = "#f59e0b";

function readColor(app) {
  return app.storage.get(COLOR_KEY).then(function (value) {
    return typeof value === "string" && value ? value : DEFAULT_COLOR;
  });
}

/* Widget snapshots: pure HTML (the host renders them in inert iframes). */
function starHtml(color) {
  return (
    '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
    "background:radial-gradient(circle at 50% 40%, " + color + "22, transparent 70%);" +
    'border-radius:12px;">' +
    '<svg viewBox="0 0 24 24" width="70%" height="70%" fill="' + color + '">' +
    '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>' +
    "</svg></div>"
  );
}
function heartHtml(color) {
  return (
    '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
    "background:radial-gradient(circle at 50% 40%, " + color + "22, transparent 70%);" +
    'border-radius:12px;">' +
    '<svg viewBox="0 0 24 24" width="70%" height="70%" fill="' + color + '">' +
    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' +
    "</svg></div>"
  );
}
function burstHtml(color) {
  return (
    '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
    "background:radial-gradient(circle at 50% 50%, " + color + "22, transparent 70%);" +
    'border-radius:12px;">' +
    '<svg viewBox="0 0 24 24" width="70%" height="70%" fill="' + color + '">' +
    '<path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" ' +
    'stroke="' + color + '" stroke-width="2.4" stroke-linecap="round"/>' +
    '<circle cx="12" cy="12" r="3.4"/>' +
    "</svg></div>"
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

  /* ---- headless: registrations ---- */

  app.objects.register({
    id: "star",
    titleKey: "sticky-shape-pack:shape.star.title",
    group: "sticky-shape-pack:group",
    order: 10,
    icon: "Star",
    preview: "⭐",
    width: 140,
    height: 140,
    factory: function () {
      return readColor(app).then(function (color) {
        return { color: color, createdAt: Date.now() };
      });
    },
    renderWidget: function (data) {
      return starHtml(typeof data.color === "string" ? data.color : DEFAULT_COLOR);
    }
  });

  app.objects.register({
    id: "heart",
    titleKey: "sticky-shape-pack:shape.heart.title",
    group: "sticky-shape-pack:group",
    order: 11,
    icon: "Heart",
    preview: "❤",
    width: 140,
    height: 140,
    factory: function () {
      return readColor(app).then(function (color) {
        return { color: color, createdAt: Date.now() };
      });
    },
    renderWidget: function (data) {
      return heartHtml(typeof data.color === "string" ? data.color : DEFAULT_COLOR);
    }
  });

  app.objects.register({
    id: "burst",
    titleKey: "sticky-shape-pack:shape.burst.title",
    group: "sticky-shape-pack:group",
    order: 12,
    icon: "Sparkles",
    preview: "✺",
    width: 140,
    height: 140,
    factory: function () {
      return readColor(app).then(function (color) {
        return { color: color, createdAt: Date.now() };
      });
    },
    renderWidget: function (data) {
      return burstHtml(typeof data.color === "string" ? data.color : DEFAULT_COLOR);
    }
  });

  app.commands.register({
    id: "insertStar",
    titleKey: "sticky-shape-pack:command.insertStar",
    icon: "Star",
    execute: function () {
      app.objects.create("star");
    }
  });

  app.panels.register({
    id: "shapes",
    titleKey: "sticky-shape-pack:panel.title",
    icon: "Puzzle",
    placement: "right",
    order: 850
  });

  app.settings.register({
    id: "appearance",
    titleKey: "sticky-shape-pack:settings.title",
    order: 850
  });
}

/* ---- region rendering (the plugin's own iframe DOM) ---- */

function renderRegion(app) {
  var regionId = app.region.id;
  var isSettings = regionId.indexOf("settings:") === 0;
  document.body.innerHTML = "";
  document.body.dir = LANG === "en" ? "ltr" : "rtl";
  document.body.style.cssText =
    "margin:0;padding:10px;font:12px/1.7 system-ui,sans-serif;" +
    "color:#e7e5e4;background:transparent;display:flex;flex-direction:column;gap:8px;";

  if (isSettings) {
    renderSettingsRegion(app);
  } else {
    renderPanelRegion(app);
  }
}

function renderPanelRegion(app) {
  var hint = document.createElement("p");
  hint.textContent = T("insertHint");
  hint.style.cssText = "margin:0 0 4px;opacity:.75;";
  document.body.appendChild(hint);

  var createdNote = document.createElement("p");
  createdNote.textContent = "";
  createdNote.style.cssText = "margin:0;opacity:0;transition:opacity .3s;color:#34d399;";

  var buttons = [
    { local: "star", label: "⭐ " + T("star") },
    { local: "heart", label: "❤ " + T("heart") },
    { local: "burst", label: "✺ " + T("burst") }
  ];
  buttons.forEach(function (item) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.style.cssText =
      "display:block;width:100%;padding:8px 10px;text-align:start;border-radius:10px;" +
      "border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.55);color:#e7e5e4;" +
      "cursor:pointer;margin-bottom:6px;font:inherit;";
    button.addEventListener("click", function () {
      app.objects.create(item.local).then(function (result) {
        if (result) {
          createdNote.textContent = T("created");
          createdNote.style.opacity = "1";
          setTimeout(function () {
            createdNote.style.opacity = "0";
          }, 1600);
        }
      });
    });
    document.body.appendChild(button);
  });
  document.body.appendChild(createdNote);
}

function renderSettingsRegion(app) {
  var description = document.createElement("p");
  description.textContent = T("description");
  description.style.cssText = "margin:0 0 6px;opacity:.75;";
  document.body.appendChild(description);

  var row = document.createElement("label");
  row.style.cssText = "display:flex;align-items:center;gap:8px;cursor:pointer;";
  var label = document.createElement("span");
  label.textContent = T("color");
  var input = document.createElement("input");
  input.type = "color";
  input.value = DEFAULT_COLOR;
  var saved = document.createElement("span");
  saved.textContent = "";
  saved.style.cssText = "opacity:0;transition:opacity .3s;color:#34d399;font-size:10px;";
  row.appendChild(label);
  row.appendChild(input);
  row.appendChild(saved);
  document.body.appendChild(row);

  app.storage.get(COLOR_KEY).then(function (value) {
    if (typeof value === "string" && value) {
      input.value = value;
    }
  });
  input.addEventListener("change", function () {
    app.storage.set(COLOR_KEY, input.value).then(function () {
      saved.textContent = T("saved");
      saved.style.opacity = "1";
      setTimeout(function () {
        saved.style.opacity = "0";
      }, 1600);
    });
  });
}

