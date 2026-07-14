---
description: Build, sign and publish a new Lumina release (+ updater manifest) so installed apps auto-update
argument-hint: <version> [release notes]
---

The user wants to cut a new Lumina release. Arguments: `$ARGUMENTS`
(first token = target version like `0.2.0`; the rest, if any, = release notes).

This drives `scripts/release.mjs`, which bumps the version, builds a **signed**
Windows NSIS installer, writes the `latest.json` updater manifest, tags, pushes,
and creates the GitHub Release. Installed apps poll
`releases/latest/download/latest.json` and will offer the update.

Do the following, stopping to report if any step fails:

1. **Parse arguments.** If no version was given, ask the user for one. Validate
   it looks like `major.minor.patch`.

2. **Preflight (fail fast, before the long build):**
   - `git status --porcelain` must be empty. If not, show the changes and ask
     the user to commit/stash — do NOT commit unrelated work yourself.
   - Confirm `.env.release` exists and the signing key path inside it exists.
   - Confirm `gh auth status` succeeds. If not, tell the user to run
     `gh auth login` (interactive — they must do it).
   - Confirm the new version is greater than the current `package.json` version
     and that tag `v<version>` does not already exist.

3. **Run the release script**, forwarding the notes if provided:
   `node scripts/release.mjs <version> [notes]`
   Note: `cargo` must be on PATH; the script adds `%USERPROFILE%\.cargo\bin`
   itself. The signed build takes several minutes (LTO release build) — run it
   in the background and report progress rather than blocking silently.

4. **Verify** after the script finishes:
   - The GitHub Release `v<version>` exists with both `*-setup.exe` and
     `latest.json` attached (`gh release view v<version> --repo <slug>`).
   - `latest.json` is reachable at
     `https://github.com/<slug>/releases/latest/download/latest.json` and its
     `version` field matches.

5. **Report** the release URL and remind the user that only **Windows** updates
   are published by this flow (macOS/Linux would need CI).

Never bypass the clean-tree / auth / signing checks, and never commit the
signing secrets. If the build fails after the version bump, tell the user the
working tree holds the bump so they can `git checkout -- <files>` to revert.
