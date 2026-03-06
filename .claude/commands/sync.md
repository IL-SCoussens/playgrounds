Sync playgrounds from source repos, update the index (with sync timestamp), commit, and push.

Steps:
1. Run `./sync.sh` from the repo root and capture its full output. The script regenerates `index.html` with the current date/time in the footer.
2. Summarize what happened: which files were added (new), updated, or unchanged.
3. If any files were added or updated, show a brief diff summary of what changed in `docs/`.
4. If any warnings occurred (failed clones, missing source files), highlight them and suggest fixes.
5. If there are changes to commit, commit them with a descriptive message and push to origin.
6. If there are no changes (other than the timestamp), report that everything is up to date.
