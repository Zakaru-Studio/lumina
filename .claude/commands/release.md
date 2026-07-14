---
description: Build, sign and publish a new Lumina release (+ updater manifest) so installed apps auto-update
argument-hint: <version> [release notes]
---

The user wants to cut a new Lumina release. Arguments: `$ARGUMENTS`
(first token = target version like `0.2.0`; the rest, if any, = release notes).

This drives `scripts/release.mjs`, which bumps the version, builds a **signed**
Windows NSIS installer, writes the `latest.json` updater manifest, tags, pushes,
uploads the installer + `latest.json` to the **self-hosted update host** over SSH,
and (best-effort) publishes a GitHub Release. Installed apps poll the updater
endpoint baked into `tauri.conf.json` — `plugins.updater.endpoints[0]`, i.e.
`https://zakaru.dev/lumina/updates/latest.json` — and will offer the update. The
GitHub Release is only for visibility; the updater never reads it.

Do the following, stopping to report if any step fails:

1. **Parse arguments.** If no version was given, ask the user for one. Validate
   it looks like `major.minor.patch`.

2. **Preflight (fail fast, before the long build):**
   - `git status --porcelain` must be empty. If not, show the changes and ask
     the user to commit/stash — do NOT commit unrelated work yourself.
   - Confirm `.env.release` exists and the signing key path inside it exists.
   - `gh auth status` is **optional**: the GitHub Release is best-effort and the
     script skips it (never fails) when gh is unauthenticated. The updater does
     not depend on it — only mention `gh auth login` if the user also wants the
     GitHub Release published.
   - Confirm `.env.release` also has the self-host upload config
     (`LUMINA_UPDATE_BASE_URL`, `LUMINA_SSH_HOST/USER/KEY`) — this is what the
     updater actually consumes. `LUMINA_UPDATE_BASE_URL` must match the endpoint
     base in `tauri.conf.json` (`https://zakaru.dev/lumina/updates`).
   - Confirm the new version is greater than the current `package.json` version
     and that tag `v<version>` does not already exist.

3. **Run the release script**, forwarding the notes if provided:
   `node scripts/release.mjs <version> [notes]`
   Note: `cargo` must be on PATH; the script adds `%USERPROFILE%\.cargo\bin`
   itself. The signed build takes several minutes (LTO release build) — run it
   in the background and report progress rather than blocking silently.

4. **Verify** after the script finishes:
   - The live updater manifest the app actually polls is reachable and updated:
     `curl -fsSL https://zakaru.dev/lumina/updates/latest.json` returns JSON whose
     `version` equals `<version>` and whose `platforms.windows-x86_64.url` points
     at the new `Lumina_<version>_x64-setup.exe`. (This is the real one-click
     update source — verifying it is the point.)
   - (Optional) If a GitHub Release was published, `gh release view v<version>
     --repo <slug>` shows the installer + `latest.json` attached.

5. **Report** the release URL and remind the user that only **Windows** updates
   are published by this flow (macOS/Linux would need CI).

Never bypass the clean-tree / auth / signing checks, and never commit the
signing secrets. If the build fails after the version bump, tell the user the
working tree holds the bump so they can `git checkout -- <files>` to revert.
