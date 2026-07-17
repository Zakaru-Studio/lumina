# Packaging Lumina as MSIX (Microsoft Store)

Lumina's primary distribution is the **signed NSIS installer + self-hosted
updater** (`scripts/release.mjs`). This MSIX flow is a **separate, optional**
channel for the **Microsoft Store** (or clean sideloading). The two are
independent: the Store delivers and updates the MSIX itself, so the Tauri
self-hosted updater does not apply to Store installs.

Tauri v2 does not emit MSIX natively, so we use Microsoft's official
**`winapp` CLI** (Windows App Development CLI) — see the
[Tauri + winapp guide](https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli/guides/tauri).

## Prerequisite (one-time)

```powershell
winget install microsoft.winappcli
```

## Build the package

```powershell
# Unsigned, Store-ready .msix from the EXISTING release binary:
npm run pack:msix

# Compile a fresh release binary first, then package:
npm run pack:msix -- --build

# Sign with a self-signed dev cert AND trust it, so it installs locally to test:
npm run pack:msix -- --sign
```

Output: `msix/out/Lumina_<version>_x64.msix` (version comes from `package.json`,
padded to the 4-part MSIX form `a.b.c.0`). `pack:msix` stages `lumina.exe` +
`msix/Assets/` + `msix/Package.appxmanifest` into a self-contained layout and
runs `winapp pack` — Tauri's web `dist/` is **not** the payload; the exe embeds
the frontend.

Test a `--sign` build locally:

```powershell
Add-AppxPackage .\msix\out\Lumina_<version>_x64.msix
# remove it again:
Get-AppxPackage *Lumina* | Remove-AppxPackage
```

## Submitting to the Microsoft Store

1. Create a **Partner Center** developer account (one-time fee) and **reserve the
   app name** ("Lumina" if free).
2. In Partner Center → your app → **Product management → Product identity**, copy
   the three values and put them in `msix/Package.appxmanifest`:
   - `Identity/@Name`  ← *Package/Identity/Name*
   - `Identity/@Publisher`  ← *Publisher* (e.g. `CN=…`)
   - `Properties/PublisherDisplayName`  ← *Publisher display name*

   These are currently **placeholders** (`ZakaruStudio.Lumina` / `CN=Zakaru Studio`)
   and must match Partner Center exactly or the submission is rejected.
3. `npm run pack:msix` → upload the **unsigned** `.msix`. **The Store signs it** —
   don't sign it yourself for submission.
4. (Recommended) Run the **Windows App Certification Kit (WACK)** on the package
   before uploading to catch Store-policy issues early.

## Notes

- A Store update requires a **strictly higher** version. Bump `package.json`
  (the manifest version is synced from it at pack time).
- This produces **x64 only**. To also ship Arm64 you'd cross-compile an Arm64
  release binary and pass both staged folders to `winapp pack` to get a
  `.msixbundle` (see the winapp docs).
- A packaged full-trust desktop app runs unsandboxed as the user, so it reads the
  user's photo folders normally — no `broadFileSystemAccess` capability needed.
