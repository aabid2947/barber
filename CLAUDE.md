# CLAUDE.md

Project-specific instructions for Claude Code working in this repository.

## Required Maintenance After File Changes

Two documentation files must be kept in sync with the codebase at all times:

- `agent_file_map.md` — short, practical per-file summaries grouped by area.
- `repo_structure.md` — snapshot of the project tree.

After ANY file change you make in this repo, update these files as part of the same task (before reporting the work complete).

### 1. Update `agent_file_map.md` on every file change

Whenever you create, modify, rename, move, or delete a file:

- **Modified file**: Re-read the file and update its bullet in `agent_file_map.md` so the one-line summary still accurately reflects what the file does. If behavior did not meaningfully change, leave the line as-is.
- **New file**: Add a new bullet in the correct section, matching the existing style:
  - Format: `` - `path/to/file.ext`: Short practical summary of what lives here. ``
  - Keep the summary to a single line, action-oriented, focused on purpose (not implementation detail).
  - Place it under the appropriate existing section header (e.g., `## Frontend Routes (`app/`)`, `## Shared Library (`lib/`)`, `### Android Resources`). Create a new section only if no existing one fits.
- **Renamed/moved file**: Update the path in the existing bullet and move it to the correct section if needed.
- **Deleted file**: Remove its bullet.

Match the tone and brevity of existing entries — terse, descriptive, one line per file.

### 2. Update `repo_structure.md` when files are added, removed, renamed, or moved

`repo_structure.md` contains an ASCII tree inside a ```text fenced block. Keep it accurate:

- **New file or directory**: Insert it into the tree in the correct alphabetical/grouping position, using the same `|--` indentation style as the surrounding entries.
- **Removed file or directory**: Delete the corresponding line (and prune empty parent directories if they no longer contain anything).
- **Renamed/moved file**: Remove the old entry and add the new one in the right place.
- **Content-only edits** (no path changes): No update needed.

Preserve the existing formatting exactly — same indent width, same `|--` connectors, same trailing-slash convention for directories.

### Workflow

1. Make the requested code change.
2. Update `agent_file_map.md` for every affected file.
3. Update `repo_structure.md` if the set of paths changed.
4. Then report the task complete.

Do not skip these updates, even for small changes. They are the project's source of truth for agents navigating the repo.
