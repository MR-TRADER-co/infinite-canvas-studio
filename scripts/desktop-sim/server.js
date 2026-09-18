/**
 * Desktop SIMULATION server (fix round 1) — runs the VITE desktop bundle
 * (the exact frontend inside the exe) in a normal browser with a Tauri
 * shim, so the desktop-only code paths (TauriAssetStore, icbasset URLs,
 * chunked IPC writes, TauriAppDataStorage) can be E2E-verified without
 * a Windows build.
 *
 *   node scripts/desktop-sim/server.js        → http://127.0.0.1:8899/
 *
 * What it mocks (mirroring src-tauri/src/assets.rs + lib.rs):
 *  - window.__TAURI_INTERNALS__  (injected into index.html before app code)
 *      · convertFileSrc(path, protocol) → /__sim/asset/<path>
 *      · invoke(cmd, args)            → POST /__sim/invoke
 *      · transformCallback / metadata (the event + window API surfaces)
 *  - POST /__sim/invoke          → asset_write_chunk / asset_exists /
 *                                  asset_relocate / append_log /
 *                                  save_text_file / read_text_file /
 *                                  delete_text_file / save_binary_file /
 *                                  plugin:path|resolve_directory /
 *                                  plugin:event|listen|unlisten /
 *                                  plugin:sql|load|execute (empty rows)
 *  - GET  /__sim/asset/<hash>    → the icbasset:// protocol twin: serves
 *                                  the stored bytes (scope chain
 *                                  [?project sidecar, inbox]) with mime +
 *                                  Range/206 + the CORS/cache headers.
 *  - everything else             → the static files of dist/ (the exe's
 *                                  frontendDist).
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8899;
const DIST = path.resolve(__dirname, "..", "..", "dist");
const ROOT = path.resolve(__dirname, "sim-data");
const INBOX = path.join(ROOT, "media-inbox");
fs.mkdirSync(INBOX, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
};

/** 64 lower-case hex guard (assets.rs's is_valid_hash_name). */
function isValidHash(hash) {
  return (
    typeof hash === "string" &&
    hash.length === 64 &&
    /^[0-9a-f]+$/.test(hash)
  );
}

/** A sidecar scope must end with the .assets suffix (assets.rs). */
function sidecarOf(scope) {
  if (typeof scope !== "string" || !scope.endsWith(".assets")) {
    return null;
  }
  return scope;
}

/** Reads the request body (JSON). */
function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

/** Base64 → Buffer. */
function decodeBase64(text) {
  return Buffer.from(String(text), "base64");
}

/** The IPC command implementations (the assets.rs + lib.rs twins). */
async function handleInvoke(payload, log) {
  const cmd = String(payload.cmd || "");
  const args = payload.args || {};
  switch (cmd) {
    case "asset_write_chunk": {
      const hash = String(args.hash || "");
      if (!isValidHash(hash)) {
        return { ok: false, error: "invalid asset hash" };
      }
      let dir = INBOX;
      if (args.scope !== null && args.scope !== undefined) {
        const sidecar = sidecarOf(String(args.scope));
        if (sidecar === null) {
          return { ok: false, error: "asset scope must be a .assets sidecar" };
        }
        dir = sidecar;
      }
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, hash);
      const offset = Number(args.offset || 0);
      const bytes = decodeBase64(String(args.contents || ""));
      const fd = fs.openSync(target, "a+");
      try {
        fs.writeSync(fd, bytes, 0, bytes.length, offset);
      } finally {
        fs.closeSync(fd);
      }
      return { ok: true, data: null };
    }
    case "asset_exists": {
      const hash = String(args.hash || "");
      if (!isValidHash(hash)) {
        return { ok: true, data: false };
      }
      const places = [];
      if (args.scope !== null && args.scope !== undefined) {
        const sidecar = sidecarOf(String(args.scope));
        if (sidecar !== null) {
          places.push(path.join(sidecar, hash));
        }
      }
      places.push(path.join(INBOX, hash));
      return { ok: true, data: places.some((p) => fs.existsSync(p)) };
    }
    case "asset_relocate": {
      const toScope = sidecarOf(String(args.toScope || ""));
      if (toScope === null) {
        return { ok: false, error: "relocation target must be a .assets sidecar" };
      }
      fs.mkdirSync(toScope, { recursive: true });
      const missing = [];
      for (const hash of Array.isArray(args.hashes) ? args.hashes : []) {
        if (!isValidHash(hash)) {
          missing.push(hash);
          continue;
        }
        let source = path.join(INBOX, hash);
        if (args.fromScope !== null && args.fromScope !== undefined) {
          const from = sidecarOf(String(args.fromScope));
          source = from !== null ? path.join(from, hash) : path.join(INBOX, hash);
        }
        const target = path.join(toScope, hash);
        if (fs.existsSync(target)) {
          continue;
        }
        if (!fs.existsSync(source)) {
          missing.push(hash);
          continue;
        }
        if (args.mode === "move") {
          fs.renameSync(source, target);
        } else {
          fs.copyFileSync(source, target);
        }
      }
      return { ok: true, data: missing };
    }
    case "append_log":
      return { ok: true, data: null };
    case "save_text_file": {
      const target = String(args.path || "");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, String(args.contents || ""), "utf8");
      return { ok: true, data: target };
    }
    case "read_text_file": {
      const target = String(args.path || "");
      if (!fs.existsSync(target)) {
        return { ok: false, error: `ENOENT: ${target}` };
      }
      return { ok: true, data: fs.readFileSync(target, "utf8") };
    }
    case "delete_text_file": {
      const target = String(args.path || "");
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
      return { ok: true, data: null };
    }
    case "save_binary_file": {
      const target = String(args.path || "");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, decodeBase64(String(args.contents || "")));
      return { ok: true, data: target };
    }
    case "plugin:path|resolve_directory":
      // The app-data twin — everything lands under sim-data/.
      return { ok: true, data: ROOT };
    case "plugin:event|listen":
    case "plugin:event|unlisten":
      return { ok: true, data: 1 };
    case "plugin:sql|load":
      return { ok: true, data: "sim" };
    case "plugin:sql|execute":
      // The version history stays empty in the simulation.
      return { ok: true, data: { rows: [], rowsAffected: 0 } };
    default:
      log(`UNKNOWN COMMAND: ${cmd} ${JSON.stringify(args).slice(0, 200)}`);
      return { ok: false, error: `unknown command: ${cmd}` };
  }
}

/** The icbasset:// twin: /__sim/asset/<hash>?project=&mime= with Range. */
function serveAsset(request, response, pathname, query) {
  const hash = pathname.replace(/^\/__sim\/asset\//, "");
  if (!isValidHash(hash)) {
    response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
    response.end("invalid asset hash");
    return;
  }
  const params = new URLSearchParams(query);
  const mime = params.get("mime") || "application/octet-stream";
  const candidates = [];
  const project = params.get("project");
  if (project !== null && project.endsWith(".icb")) {
    candidates.push(path.join(`${project}.assets`, hash));
  } else if (project !== null && project.endsWith(".assets")) {
    candidates.push(path.join(project, hash));
  }
  candidates.push(path.join(INBOX, hash));
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (file === undefined) {
    response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
    response.end("asset not found");
    return;
  }
  const bytes = fs.readFileSync(file);
  const range = request.headers["range"];
  const match =
    typeof range === "string"
      ? /^bytes=(\d+)-(\d*)$/.exec(range.trim())
      : null;
  if (match !== null) {
    const start = Number(match[1]);
    const end =
      match[2] === ""
        ? Math.min(bytes.length - 1, start + 8 * 1024 * 1024 - 1)
        : Math.min(Number(match[2]), bytes.length - 1);
    if (start >= bytes.length) {
      response.writeHead(416, {
        "Content-Range": `bytes */${bytes.length}`,
        "Access-Control-Allow-Origin": "*",
      });
      response.end();
      return;
    }
    response.writeHead(206, {
      "Content-Type": mime,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    response.end(bytes.subarray(start, end + 1));
    return;
  }
  response.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": String(bytes.length),
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  response.end(bytes);
}

/** The Tauri shim injected into the served index.html (before app code). */
const SHIM = `<script>
(function () {
  var callbacks = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
      windows: ["main"],
      webviews: ["main"]
    },
    convertFileSrc: function (filePath, protocol) {
      return "/__sim/asset/" + encodeURIComponent(filePath);
    },
    transformCallback: function (callback) {
      var id = ++callbacks;
      Object.defineProperty(window, "_" + id, {
        value: callback,
        writable: false,
        configurable: true
      });
      return id;
    },
    invoke: function (cmd, args) {
      return fetch("/__sim/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: cmd, args: args === undefined ? {} : args })
      }).then(function (response) {
        return response.json().then(function (payload) {
          if (!payload.ok) {
            throw new Error(payload.error || "ipc failed");
          }
          return payload.data;
        });
      });
    }
  };
})();
</script>`;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  if (request.method === "POST" && pathname === "/__sim/invoke") {
    const payload = await readBody(request);
    const result = await handleInvoke(payload, (line) =>
      console.log(`[sim] ${line}`),
    );
    sendJson(response, 200, result);
    return;
  }
  if (pathname.startsWith("/__sim/asset/")) {
    serveAsset(request, response, pathname, url.search.replace(/^\?/, ""));
    return;
  }
  // Static dist/ serving — index.html gets the shim injected.
  let file = pathname === "/" ? path.join(DIST, "index.html") : path.join(DIST, pathname);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, "index.html");
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end(`not found: ${pathname}`);
    return;
  }
  const bytes = fs.readFileSync(file);
  if (file.endsWith(".html")) {
    const html = bytes.toString("utf8").replace(
      /<head([^>]*)>/i,
      (head) => `${head}\n${SHIM}`,
    );
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }
  response.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "Content-Length": String(bytes.length),
  });
  response.end(bytes);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[sim] desktop simulation on http://127.0.0.1:${PORT}/`);
  console.log(`[sim] dist: ${DIST}`);
  console.log(`[sim] app-data root: ${ROOT}`);
});
