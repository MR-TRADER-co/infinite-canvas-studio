#!/usr/bin/env bash
#
# Per-phase project snapshot (the user's standing requirement):
# zips the whole project (minus runtime/excluded trees) as
# public/snapshots/<phase>.zip — downloadable at /snapshots/<phase>.zip —
# with a PHASE-CHANGES.txt manifest (ADDED/MODIFIED/DELETED vs the previous
# snapshot's sha256 manifest; the first run diffs against the original
# upload zip) and a phase-changed/ folder of copies.
#
# Step 7 (DECISIONS #42): every run also refreshes
# public/downloads/infinite-canvas-studio.zip — the byte-identical bundle
# the in-app «دانلود سورس کامل (ZIP)» menu item probes — so the delivery
# link can never go stale again.
#
# Usage: bash scripts/phase-snapshot.sh <phase-name> [baseline-zip]
#
set -euo pipefail

PHASE="${1:?usage: phase-snapshot.sh <phase-name> [baseline-zip]}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SNAP_DIR="public/snapshots"
META_DIR="$SNAP_DIR/.meta"
BASELINE="${2:-}"
PREV_MANIFEST=""

mkdir -p "$SNAP_DIR" "$META_DIR" "public/downloads"

# ── 1. Resolve the diff baseline ────────────────────────────────────────
# Newest previous snapshot manifest wins; explicit baseline arg second;
# the original phase-10 upload zip is the first-run fallback.
if [[ -z "$BASELINE" ]]; then
  LATEST="$(ls -1 "$META_DIR"/*.manifest.txt 2>/dev/null | sort | tail -1 || true)"
  if [[ -n "$LATEST" ]]; then
    BASELINE="$(basename "$LATEST" .manifest.txt).zip"
    PREV_MANIFEST="$LATEST"
  elif [[ -f "upload/infinite-canvas-studio-phase10.zip" ]]; then
    BASELINE="upload/infinite-canvas-studio-phase10.zip"
  fi
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── 2. Zip the current project (root folder = <phase>/) ─────────────────
STAGE="$WORK/$PHASE"
mkdir -p "$STAGE"
rsync -a --quiet \
  --exclude 'node_modules/' --exclude '.git/' --exclude '.next/' \
  --exclude 'public/snapshots/' --exclude 'public/downloads/' \
  --exclude 'tool-results/' \
  --exclude 'dev.log' --exclude 'db/*.db' --exclude 'db/*.db-*' \
  --exclude '.zscripts/' --exclude 'upload/' --exclude 'skills/' \
  --exclude 'download/' --exclude 'examples/' --exclude 'mini-services/' \
  --exclude '.agent-browser/' --exclude 'bun.lockb' \
  ./ "$STAGE/"

# ── 3. Build this snapshot's sha256 manifest ────────────────────────────
MANIFEST="$WORK/manifest.txt"
(cd "$STAGE" && find . -type f | sed 's|^\./||' | sort | \
  xargs -r sha256sum) > "$MANIFEST"

# ── 4. PHASE-CHANGES.txt (ADDED/MODIFIED/DELETED vs baseline) ───────────
CHANGES="$WORK/PHASE-CHANGES.txt"
{
  echo "PHASE-CHANGES — $PHASE"
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Baseline: ${BASELINE:-<none>}"
  echo
} > "$CHANGES"

BASE_STAGE=""
if [[ -n "$BASELINE" ]]; then
  if [[ -n "$PREV_MANIFEST" ]]; then
    cp "$PREV_MANIFEST" "$WORK/baseline.manifest.txt"
    BASE_STAGE=""
  else
    BASE_STAGE="$WORK/baseline"
    mkdir -p "$BASE_STAGE"
    (cd "$BASE_STAGE" && unzip -qq -o "$ROOT/$BASELINE") || true
    # Normalise the archive's single root folder (any name) away.
    ENTRIES=("$BASE_STAGE"/*)
    if [[ ${#ENTRIES[@]} -eq 1 && -d "${ENTRIES[0]}" ]]; then
      INNER="${ENTRIES[0]}"
      (cd "$INNER" && find . -type f | sed 's|^\./||' | sort | \
        xargs -r sha256sum) > "$WORK/baseline.manifest.txt" || true
    else
      (cd "$BASE_STAGE" && find . -type f | sed 's|^\./||' | sort | \
        xargs -r sha256sum) > "$WORK/baseline.manifest.txt" || true
    fi
  fi

  if [[ -s "$WORK/baseline.manifest.txt" ]]; then
    awk '{print $2}' "$WORK/baseline.manifest.txt" | sort > "$WORK/base-files"
    awk '{print $2}' "$MANIFEST" | sort > "$WORK/now-files"
    comm -13 "$WORK/base-files" "$WORK/now-files" | \
      sed 's|^|ADDED    |' >> "$CHANGES"
    comm -23 "$WORK/base-files" "$WORK/now-files" | \
      sed 's|^|DELETED  |' >> "$CHANGES"
    comm -12 "$WORK/base-files" "$WORK/now-files" | while read -r f; do
      B="$(awk -v f="$f" '$2==f {print $1}' "$WORK/baseline.manifest.txt")"
      N="$(awk -v f="$f" '$2==f {print $1}' "$MANIFEST")"
      [[ "$B" != "$N" ]] && echo "MODIFIED $f" >> "$CHANGES" || true
    done
  fi
else
  echo "(no baseline — first snapshot)" >> "$CHANGES"
fi

CHANGED_COUNT="$(grep -cE '^(ADDED|MODIFIED|DELETED)' "$CHANGES" || true)"
{
  echo
  echo "Total changed entries: $CHANGED_COUNT"
} >> "$CHANGES"

# ── 5. phase-changed/ copies ────────────────────────────────────────────
CHANGED_DIR="$STAGE/phase-changed"
mkdir -p "$CHANGED_DIR"
grep -E '^(ADDED|MODIFIED)' "$CHANGES" | awk '{print $2}' | while read -r f; do
  [[ -f "$STAGE/$f" ]] || continue
  mkdir -p "$CHANGED_DIR/$(dirname "$f")"
  cp "$STAGE/$f" "$CHANGED_DIR/$f"
done

# ── 6. Assemble the snapshot zip ────────────────────────────────────────
cp "$CHANGES" "$STAGE/PHASE-CHANGES.txt"
OUT="$SNAP_DIR/$PHASE.zip"
rm -f "$OUT"
(cd "$WORK" && zip -qq -r "$ROOT/$OUT" "$PHASE")
cp "$MANIFEST" "$META_DIR/$PHASE.manifest.txt"

# ── 7. Refresh the in-app source bundle (DECISIONS #42) ─────────────────
cp "$OUT" "public/downloads/infinite-canvas-studio.zip"

SIZE="$(du -h "$OUT" | cut -f1)"
FILES="$(unzip -l "$OUT" | tail -1 | awk '{print $2}')"
echo "✔ $OUT ($SIZE, $FILES entries) — baseline: ${BASELINE:-none}, $CHANGED_COUNT changes"
echo "✔ public/downloads/infinite-canvas-studio.zip refreshed (same bytes)"
