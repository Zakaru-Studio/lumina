# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Git & commits

- **Never add Claude as a co-author.** Do not append any `Co-Authored-By: Claude ...`
  trailer (or similar AI attribution) to commit messages or PR bodies in this repo.
- Commits must be authored by the project's own identity (Aurélien Kohler / Zakaru),
  never by an unrelated account.

## Releasing

Releases are **local & self-hosted** — there is no GitHub Actions / GitHub Release step.
`node scripts/release.mjs <version> "<notes>"` (or the `/release` skill) builds a signed
NSIS installer, tags `v<version>`, pushes the tag, and uploads the installer + `latest.json`
to the self-hosted update host over SSH. Installed apps auto-update by polling the
`updater.endpoints` URL in `src-tauri/tauri.conf.json`. Requires a gitignored
`.env.release` (signing key + SSH deploy key) that is **not** in the repo.
