# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A central collection point for interactive HTML playgrounds from across the Intellilake platform. Playground HTML files are authored in their respective source repos and pulled into this repo via `sync.sh`. Hosted as a GitHub Pages site from the `docs/` directory.

- **Hosted at**: GitHub Pages from the `docs/` directory
- **Repo**: `https://github.com/IL-SCoussens/playgrounds`

## Structure

```
sources.json   # Registry of source repos, file paths, and index card metadata
sync.sh        # Pulls playground files from source repos, regenerates index.html
docs/
  index.html                 # Generated landing page (do not edit manually)
  platform-overview.html     # From Intellilake-Platform/platform
  hierarchy-playground.html  # From Intellilake-Platform/scratch
```

## Syncing Playgrounds

```bash
./sync.sh   # Pull latest playground files from all source repos, regenerate index
```

Requires: `git`, `jq`

The script shallow-clones each repo listed in `sources.json`, copies the specified HTML files into `docs/`, and regenerates `index.html` from the metadata in `sources.json`. It reports which files were added, updated, or unchanged.

## Adding a New Playground

1. Create the playground HTML file in its source repo (e.g., `platform`, `scratch`)
2. Add an entry to `sources.json` under the appropriate source's `files` array:
   - `src`: path within the source repo
   - `dest`: filename in `docs/`
   - `title`, `description`, `icon`, `icon_color`, `tags`: index card metadata
3. Run `./sync.sh` — it pulls the file and regenerates the index

Available tag/icon colors: `accent`, `green`, `amber`, `blue`, `purple`, `cyan`

## Adding a New Source Repo

Add a new object to the `sources` array in `sources.json`:
```json
{
  "repo": "Intellilake-Platform/repo-name",
  "branch": "main",
  "files": [ ... ]
}
```

## Conventions

- Each playground is a single `.html` file with inline CSS and JS — no external dependencies
- Dark theme using CSS custom properties (`:root` vars like `--bg`, `--surface`, `--accent`, etc.)
- Playgrounds include interactive controls (tabs, toggles, config panels) and a prompt/copy-out feature
- `docs/index.html` is generated — edit `sources.json` to change card content, not the HTML directly
- These document the broader Intellilake platform (see parent workspace `CLAUDE.md` at `../CLAUDE.md` for full platform context)
