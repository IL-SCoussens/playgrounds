#!/usr/bin/env bash
# sync.sh — Pull playground HTML files from source repos and regenerate index.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCS_DIR="$SCRIPT_DIR/docs"
SOURCES_FILE="$SCRIPT_DIR/sources.json"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required (brew install jq)"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "Error: git is required"; exit 1; }

[ -f "$SOURCES_FILE" ] || { echo "Error: sources.json not found"; exit 1; }
mkdir -p "$DOCS_DIR"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
color_rgb() {
  case "$1" in
    accent) echo "99,102,241" ;;
    green)  echo "34,197,94"  ;;
    amber)  echo "245,158,11" ;;
    blue)   echo "59,130,246" ;;
    purple) echo "168,85,247" ;;
    cyan)   echo "6,182,212"  ;;
    *)      echo "99,102,241" ;;
  esac
}

html_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

branch_dest() {
  local dest="$1" branch="$2" num_branches="$3"
  if [ "$num_branches" -le 1 ]; then
    echo "$dest"
  else
    local base="${dest%.*}"
    local ext="${dest##*.}"
    echo "${base}-${branch}.${ext}"
  fi
}

tab_label() {
  case "$1" in
    main)    echo "Production" ;;
    staging) echo "Staging" ;;
    *)       echo "$1" ;;
  esac
}

# Emit card HTML for all files matching a given branch, appending to $INDEX.
emit_cards() {
  local target_branch="$1"
  for (( i=0; i<num_sources; i++ )); do
    local nb
    nb=$(jq ".sources[$i].branches | length" "$SOURCES_FILE")
    local nf
    nf=$(jq ".sources[$i].files | length" "$SOURCES_FILE")

    for (( b=0; b<nb; b++ )); do
      local br
      br=$(jq -r ".sources[$i].branches[$b]" "$SOURCES_FILE")
      [ "$br" = "$target_branch" ] || continue

      for (( j=0; j<nf; j++ )); do
        local dest icon icon_color icon_rgb title desc escaped_title escaped_desc bdest
        dest=$(jq -r ".sources[$i].files[$j].dest // empty" "$SOURCES_FILE")
        [ -z "$dest" ] && dest=$(jq -r ".sources[$i].files[$j].src | split(\"/\")[-1]" "$SOURCES_FILE")

        bdest=$(branch_dest "$dest" "$br" "$nb")
        [ -f "$DOCS_DIR/$bdest" ] || continue

        title=$(jq -r ".sources[$i].files[$j].title // \"Untitled\"" "$SOURCES_FILE")
        desc=$(jq -r ".sources[$i].files[$j].description // \"\"" "$SOURCES_FILE")
        icon=$(jq -r ".sources[$i].files[$j].icon // \"📄\"" "$SOURCES_FILE")
        icon_color=$(jq -r ".sources[$i].files[$j].icon_color // \"accent\"" "$SOURCES_FILE")

        icon_rgb=$(color_rgb "$icon_color")
        escaped_title=$(html_escape "$title")
        escaped_desc=$(html_escape "$desc")

        cat >> "$INDEX" <<CARD_OPEN

    <a class="card" href="$bdest">
      <div class="card-top">
        <div class="card-icon" style="background:rgba($icon_rgb,0.1)">$icon</div>
        <div class="card-title">$escaped_title</div>
      </div>
      <div class="card-desc">
        $escaped_desc
      </div>
      <div class="card-tags">
CARD_OPEN

        local nt
        nt=$(jq ".sources[$i].files[$j].tags | length" "$SOURCES_FILE")
        for (( k=0; k<nt; k++ )); do
          local tag_label tag_color tag_rgb escaped_label
          tag_label=$(jq -r ".sources[$i].files[$j].tags[$k].label" "$SOURCES_FILE")
          tag_color=$(jq -r ".sources[$i].files[$j].tags[$k].color // \"accent\"" "$SOURCES_FILE")
          tag_rgb=$(color_rgb "$tag_color")
          escaped_label=$(html_escape "$tag_label")
          echo "        <span class=\"tag\" style=\"background:rgba($tag_rgb,0.15);color:var(--$tag_color)\">$escaped_label</span>" >> "$INDEX"
        done

        cat >> "$INDEX" << 'CARD_CLOSE'
      </div>
    </a>
CARD_CLOSE
      done
    done
  done
}

# Check if any synced files exist for a given branch.
branch_has_files() {
  local target_branch="$1"
  for (( i=0; i<num_sources; i++ )); do
    local nb nf
    nb=$(jq ".sources[$i].branches | length" "$SOURCES_FILE")
    nf=$(jq ".sources[$i].files | length" "$SOURCES_FILE")
    for (( b=0; b<nb; b++ )); do
      local br
      br=$(jq -r ".sources[$i].branches[$b]" "$SOURCES_FILE")
      [ "$br" = "$target_branch" ] || continue
      for (( j=0; j<nf; j++ )); do
        local dest bdest
        dest=$(jq -r ".sources[$i].files[$j].dest // empty" "$SOURCES_FILE")
        [ -z "$dest" ] && dest=$(jq -r ".sources[$i].files[$j].src | split(\"/\")[-1]" "$SOURCES_FILE")
        bdest=$(branch_dest "$dest" "$br" "$nb")
        [ -f "$DOCS_DIR/$bdest" ] && return 0
      done
    done
  done
  return 1
}

# ---------------------------------------------------------------------------
# 1. Pull playground files from each source repo
# ---------------------------------------------------------------------------
new_count=0
updated_count=0
unchanged_count=0

num_sources=$(jq '.sources | length' "$SOURCES_FILE")
for (( i=0; i<num_sources; i++ )); do
  repo=$(jq -r ".sources[$i].repo" "$SOURCES_FILE")
  num_branches=$(jq ".sources[$i].branches | length" "$SOURCES_FILE")

  for (( b=0; b<num_branches; b++ )); do
    branch=$(jq -r ".sources[$i].branches[$b]" "$SOURCES_FILE")

    echo "==> Cloning $repo ($branch)..."
    repo_dir="$TEMP_DIR/repo_${i}_${b}"
    if ! git clone --depth 1 --branch "$branch" "https://github.com/$repo.git" "$repo_dir" 2>/dev/null; then
      echo "    Skipping — branch '$branch' not found"
      continue
    fi

    num_files=$(jq ".sources[$i].files | length" "$SOURCES_FILE")
    for (( j=0; j<num_files; j++ )); do
      src=$(jq -r ".sources[$i].files[$j].src" "$SOURCES_FILE")
      dest=$(jq -r ".sources[$i].files[$j].dest // empty" "$SOURCES_FILE")
      [ -z "$dest" ] && dest=$(basename "$src")

      bdest=$(branch_dest "$dest" "$branch" "$num_branches")
      src_path="$repo_dir/$src"
      dest_path="$DOCS_DIR/$bdest"

      if [ ! -f "$src_path" ]; then
        echo "    WARNING: $src not found in $repo ($branch)"
        continue
      fi

      if [ -f "$dest_path" ]; then
        if diff -q "$src_path" "$dest_path" >/dev/null 2>&1; then
          echo "    $bdest — up to date"
          unchanged_count=$((unchanged_count + 1))
        else
          echo "    $bdest — updated"
          updated_count=$((updated_count + 1))
        fi
      else
        echo "    $bdest — added (new)"
        new_count=$((new_count + 1))
      fi
      cp "$src_path" "$dest_path"
    done
  done
done

# ---------------------------------------------------------------------------
# 2. Collect active tabs (branches that have at least one synced file)
# ---------------------------------------------------------------------------
ACTIVE_TABS=()
ALL_BRANCHES=$(jq -r '[.sources[].branches[]] | unique | .[]' "$SOURCES_FILE")
for br in $ALL_BRANCHES; do
  if branch_has_files "$br"; then
    ACTIVE_TABS+=("$br")
  fi
done
NUM_TABS=${#ACTIVE_TABS[@]}

# ---------------------------------------------------------------------------
# 3. Regenerate index.html
# ---------------------------------------------------------------------------
echo ""
echo "==> Regenerating index.html..."

INDEX="$DOCS_DIR/index.html"

# --- Header ----------------------------------------------------------------
cat > "$INDEX" << 'HTML_HEAD'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Intellilake Playgrounds</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117;
    --surface: #181a20;
    --surface2: #1e2028;
    --border: #2a2d38;
    --text: #e2e4ea;
    --text-dim: #8b8fa3;
    --text-muted: #5c6078;
    --accent: #6366f1;
    --green: #22c55e;
    --blue: #3b82f6;
    --amber: #f59e0b;
    --cyan: #06b6d4;
    --purple: #a855f7;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .header {
    width: 100%;
    padding: 24px 28px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .logo {
    width: 36px; height: 36px; border-radius: 10px;
    background: linear-gradient(135deg, var(--accent), var(--cyan));
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 15px; flex-shrink: 0;
  }
  .header h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.3px; }
  .header .sub { font-size: 13px; color: var(--text-dim); }
  .content {
    max-width: 720px;
    width: 100%;
    padding: 48px 28px;
  }
  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-muted);
    margin-bottom: 16px;
  }
  .tabs {
    display: flex;
    gap: 0;
    margin-bottom: 24px;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    width: fit-content;
  }
  .tab {
    padding: 9px 20px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    cursor: pointer;
    background: var(--surface);
    border: none;
    border-right: 1px solid var(--border);
    transition: all 0.15s;
    user-select: none;
  }
  .tab:last-child { border-right: none; }
  .tab:hover { color: var(--text); background: var(--surface2); }
  .tab.active { color: var(--accent); background: rgba(99,102,241,0.08); }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  .cards { display: flex; flex-direction: column; gap: 12px; }
  .card {
    display: block;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s, transform 0.15s;
  }
  .card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
  }
  .card-top {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 10px;
  }
  .card-icon {
    width: 44px; height: 44px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; flex-shrink: 0;
  }
  .card-title { font-size: 16px; font-weight: 600; }
  .card-desc { font-size: 13px; color: var(--text-dim); line-height: 1.6; }
  .card-tags {
    display: flex; gap: 6px; flex-wrap: wrap; margin-top: 14px;
  }
  .tag {
    font-size: 10px; font-weight: 600; padding: 3px 10px;
    border-radius: 10px; letter-spacing: 0.3px;
  }
  .footer {
    margin-top: auto;
    padding: 24px 28px;
    font-size: 11px;
    color: var(--text-muted);
    text-align: center;
    border-top: 1px solid var(--border);
    width: 100%;
  }
  .footer a { color: var(--accent); text-decoration: none; }
  .footer a:hover { text-decoration: underline; }
</style>
</head>
<body>

<div class="header">
  <div class="logo">IL</div>
  <div>
    <h1>Intellilake Playgrounds</h1>
    <div class="sub">Interactive architecture docs &amp; explorers</div>
  </div>
</div>

<div class="content">
  <div class="section-label">Available Playgrounds</div>
HTML_HEAD

# --- Tab bar (only if multiple tabs) -----------------------------------------
if [ "$NUM_TABS" -gt 1 ]; then
  echo '  <div class="tabs">' >> "$INDEX"
  first=true
  for tab_branch in "${ACTIVE_TABS[@]}"; do
    label=$(tab_label "$tab_branch")
    if $first; then
      echo "    <button class=\"tab active\" data-tab=\"$tab_branch\">$label</button>" >> "$INDEX"
      first=false
    else
      echo "    <button class=\"tab\" data-tab=\"$tab_branch\">$label</button>" >> "$INDEX"
    fi
  done
  echo '  </div>' >> "$INDEX"
fi

# --- Tab panels ---------------------------------------------------------------
first=true
for tab_branch in "${ACTIVE_TABS[@]}"; do
  if [ "$NUM_TABS" -gt 1 ]; then
    if $first; then
      echo "  <div class=\"tab-panel active\" id=\"tab-$tab_branch\">" >> "$INDEX"
      first=false
    else
      echo "  <div class=\"tab-panel\" id=\"tab-$tab_branch\">" >> "$INDEX"
    fi
  fi

  echo '  <div class="cards">' >> "$INDEX"
  emit_cards "$tab_branch"
  echo '  </div>' >> "$INDEX"

  if [ "$NUM_TABS" -gt 1 ]; then
    echo '  </div>' >> "$INDEX"
  fi
done

# --- Footer & script ----------------------------------------------------------
SYNC_DATE=$(date -u '+%Y-%m-%d %H:%M UTC')
cat >> "$INDEX" <<HTML_FOOT

</div>

<div class="footer">
  Intellilake &mdash; <a href="https://github.com/IL-SCoussens/playgrounds">Source on GitHub</a> &mdash; Last synced $SYNC_DATE
</div>
HTML_FOOT

if [ "$NUM_TABS" -gt 1 ]; then
  cat >> "$INDEX" << 'HTML_SCRIPT'

<script>
document.querySelectorAll('.tab').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});
</script>
HTML_SCRIPT
fi

echo '' >> "$INDEX"
echo '</body>' >> "$INDEX"
echo '</html>' >> "$INDEX"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Done. new=$new_count updated=$updated_count unchanged=$unchanged_count"
echo "Index written to docs/index.html"
