#!/usr/bin/env bash
# fix round 2 snapshot — 41_phase-D1-fix2.zip
# Cumulative (P1+P2+D1+fix1+fix2) project snapshot + refreshed phase-changed
# subset + PHASE-CHANGES.txt section for this round.
set -euo pipefail
cd "$(dirname "$0")/../"   # project root

STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── 1. Refresh phase-changed/ with this round's files ───────────────────
pc="phase-changed"
mkdir -p "$pc/src/app" "$pc/src/ui/player" "$pc/tests/ui/player" \
        "$pc/src-tauri" "$pc/.qa/fix2"
cp src/app/globals.css                              "$pc/src/app/globals.css"
cp src/ui/player/FloatingPdfViewer.tsx              "$pc/src/ui/player/FloatingPdfViewer.tsx"
cp src/ui/player/textLayerSelection.ts             "$pc/src/ui/player/textLayerSelection.ts"
cp tests/ui/player/textLayerSelection.test.ts       "$pc/tests/ui/player/textLayerSelection.test.ts"
cp tests/ui/player/pdfTextLayerCss.test.ts          "$pc/tests/ui/player/pdfTextLayerCss.test.ts"
cp CHANGELOG.md                                     "$pc/CHANGELOG.md"
cp DECISIONS.md                                     "$pc/DECISIONS.md"
cp package.json                                     "$pc/package.json"
cp src-tauri/tauri.conf.json                        "$pc/src-tauri/tauri.conf.json"
cp .qa/fix2/00-before-floating-viewer-open.png      "$pc/.qa/fix2/00-before-floating-viewer-open.png"
cp .qa/fix2/01-after-title-selection.png            "$pc/.qa/fix2/01-after-title-selection.png"
cp .qa/fix2/02-measured-selection-on-glyphs.png    "$pc/.qa/fix2/02-measured-selection-on-glyphs.png"
cp .qa/fix2/persian-sample-fixture.pdf              "$pc/.qa/fix2/persian-sample-fixture.pdf"

# ── 2. Append the fix2 section to PHASE-CHANGES.txt ─────────────────────
python3 - "$STAMP" <<'PY'
import sys
stamp = sys.argv[1]
section = """
# Fix round 2 — the pdf.js v6 text-layer CSS contract + selection machinery (v1.48.2)
MODIFIED src/app/globals.css        (.pdf-text-layer: full pdf.js v6 port + endOfContent CSS)
MODIFIED src/ui/player/FloatingPdfViewer.tsx (--scale-factor comment + selection binding per page render)
ADDED    src/ui/player/textLayerSelection.ts (TextLayerBuilder port: endOfContent, selecting, copy normalization)
ADDED    tests/ui/player/textLayerSelection.test.ts (11 tests)
ADDED    tests/ui/player/pdfTextLayerCss.test.ts (10 tests — the CSS contract regression guard)
MODIFIED CHANGELOG.md / DECISIONS.md (1.48.2 entry + #65)
MODIFIED package.json + src-tauri/tauri.conf.json (1.48.1 -> 1.48.2)
ADDED    .qa/fix2/ (3 screenshots + the Persian fixture PDF used to reproduce)

Fix2 changed files total: 12 (3 new source/test files, 4 refreshed, 5 docs/meta)
"""
path = "PHASE-CHANGES.txt"
text = open(path, encoding="utf-8").read()
old_head = "PHASE-CHANGES — phase-D1-fix1 (cumulative: PDF P1+P2 + desktop asset twin D1 + fix round 1)"
new_head = "PHASE-CHANGES — phase-D1-fix2 (cumulative: PDF P1+P2 + desktop asset twin D1 + fix rounds 1+2)"
text = text.replace(old_head, new_head)
open(path, "w", encoding="utf-8").write(text + section)
print("PHASE-CHANGES.txt updated")
PY

# ── 3. Zip the project (the fix1 exclusion set) ─────────────────────────
OUT="/home/z/my-project/download/41_phase-D1-fix2.zip"
rm -f "$OUT"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/stage"
mkdir -p "$STAGE"
rsync -a --quiet \
  --exclude 'node_modules/' --exclude '.git/' --exclude '.next/' \
  --exclude 'public/snapshots/' --exclude 'public/downloads/' \
  --exclude 'tool-results/' \
  --exclude 'dev.log' --exclude 'db/*.db' --exclude 'db/*.db-*' \
  --exclude '.zscripts/' --exclude 'upload/' --exclude 'skills/' \
  --exclude 'download/' --exclude 'examples/' --exclude 'mini-services/' \
  --exclude '.agent-browser/' --exclude 'bun.lockb' --exclude 'dist/' \
  --exclude 'scripts/desktop-sim/sim-data/' \
  --exclude 'tsconfig.tsbuildinfo' \
  ./ "$STAGE/"
(cd "$STAGE" && zip -r -q "$OUT" .)
unzip -t "$OUT" > /dev/null && echo "integrity OK"
echo "files: $(unzip -l "$OUT" | tail -1 | awk '{print $2}')"
ls -la "$OUT"
