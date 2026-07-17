#!/usr/bin/env node
/**
 * Package Lumina as an MSIX (Microsoft Store / sideloading) via Microsoft's
 * `winapp` CLI (Windows App Development CLI).
 *
 * Usage:
 *   node scripts/pack-msix.mjs [--build] [--sign] [--out <dir>]
 *
 *   --build   Compile a fresh release binary first (`tauri build --no-bundle`).
 *             Omit to package the EXISTING src-tauri/target/release/lumina.exe.
 *   --sign    Sign with a generated self-signed dev cert AND trust it, so the
 *             .msix installs locally for testing (may prompt for admin). Omit
 *             for an UNSIGNED, Store-ready package — the Store signs on submit.
 *   --out     Output directory for the .msix (default: msix/out).
 *
 * What it does:
 *   1. Rewrites msix/Package.appxmanifest's Identity Version from package.json
 *      (4-part a.b.c.0 — the Store requires a strictly higher version to update).
 *   2. (Optional) builds the release binary.
 *   3. Stages lumina.exe + Assets + the manifest into a clean folder so the
 *      package layout is self-contained (Tauri's web ../dist is NOT the payload;
 *      the exe embeds the frontend).
 *   4. Runs `winapp pack` on that folder → Lumina_<version>_x64.msix.
 *
 * Prereqs: `winget install microsoft.winappcli`. Node built-ins only.
 * The Store-specific Identity Name / Publisher live in the manifest — set them
 * to your Partner Center values before submitting (see the manifest header).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MSIX_DIR = join(ROOT, "msix");
const SRC_TAURI = join(ROOT, "src-tauri");
const EXE_NAME = "lumina.exe"; // Cargo [[bin]] name → target/release/lumina.exe

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const step = (m) => console.log(`\n${c.cyan("▶")} ${c.bold(m)}`);
const info = (m) => console.log(`  ${c.dim(m)}`);
function fail(m) {
  console.error(`\n${c.red("✖")} ${m}\n`);
  process.exit(1);
}

/** Resolve the winapp CLI (on PATH, or its default WindowsApps shim). */
function resolveWinapp() {
  const probe = spawnSync("winapp", ["--version"], { shell: true, stdio: "ignore" });
  if (probe.status === 0) return "winapp";
  const shim = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Microsoft", "WindowsApps", "winapp.exe")
    : "";
  if (shim && existsSync(shim)) return shim;
  fail("winapp CLI not found. Install it: winget install microsoft.winappcli");
}

/** package.json version → strict 4-part MSIX version (a.b.c.0). */
function fourPartVersion() {
  const v = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) fail(`Cannot parse a version from package.json ("${v}").`);
  return `${m[1]}.${m[2]}.${m[3]}.0`;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: true, cwd: ROOT, ...opts });
  if (res.status !== 0) throw new Error(`${cmd} exited with ${res.status}`);
}

function main() {
  const args = process.argv.slice(2);
  const doBuild = args.includes("--build");
  const doSign = args.includes("--sign");
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 && args[outIdx + 1] ? resolve(args[outIdx + 1]) : join(MSIX_DIR, "out");

  const manifestPath = join(MSIX_DIR, "Package.appxmanifest");
  if (!existsSync(manifestPath)) fail(`Missing ${manifestPath}. Run "winapp init" or restore it from git.`);
  const winapp = resolveWinapp();
  const env = { ...process.env, WINAPP_CLI_TELEMETRY_OPTOUT: "1" };

  // 1. Sync the manifest version from package.json (Identity/@Version).
  step("Syncing manifest version");
  const version4 = fourPartVersion();
  const manifest = readFileSync(manifestPath, "utf8");
  const bumped = manifest.replace(/(<Identity[\s\S]*?\bVersion=")[^"]*(")/, `$1${version4}$2`);
  if (bumped === manifest && !manifest.includes(`Version="${version4}"`)) {
    fail("Could not update Identity/@Version in the manifest.");
  }
  writeFileSync(manifestPath, bumped);
  info(`Identity Version = ${version4}`);

  // 2. Optional release build (binary only — the .msix payload is the exe).
  const cargoBin = process.env.USERPROFILE ? join(process.env.USERPROFILE, ".cargo", "bin") : "";
  const buildEnv = { ...env, PATH: cargoBin ? `${process.env.PATH};${cargoBin}` : process.env.PATH };
  if (doBuild) {
    step("Building release binary (tauri build --no-bundle)");
    run("npx", ["--no-install", "tauri", "build", "--no-bundle"], { env: buildEnv });
  }
  const exePath = join(SRC_TAURI, "target", "release", EXE_NAME);
  if (!existsSync(exePath)) {
    fail(`Release binary not found: ${exePath}. Run with --build (or "npm run tauri -- build") first.`);
  }

  // 3. Stage a self-contained package layout: exe + Assets + manifest.
  step("Staging package layout");
  const stage = join(MSIX_DIR, "stage");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  copyFileSync(exePath, join(stage, EXE_NAME));
  cpSync(join(MSIX_DIR, "Assets"), join(stage, "Assets"), { recursive: true });
  copyFileSync(manifestPath, join(stage, "Package.appxmanifest"));
  info(`staged ${EXE_NAME} + Assets + manifest in ${stage}`);

  // 4. (Optional) self-signed dev certificate for local install testing.
  //    Generates a PFX (to sign) + a public .cer (to trust), whose subject
  //    matches the manifest Publisher. Generating/signing needs no elevation;
  //    trusting the cert on the machine (winapp cert install) does need admin.
  const certPfx = join(MSIX_DIR, "devcert.pfx");
  if (doSign) {
    step("Preparing dev signing certificate");
    run(
      winapp,
      ["cert", "generate", "--manifest", manifestPath, "--output", certPfx, "--export-cer", "--if-exists", "skip"],
      { env },
    );
    info(`cert: ${certPfx}`);
  }

  // 5. Pack.
  step("Packaging MSIX (winapp pack)");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `Lumina_${version4}_x64.msix`);
  const packArgs = [
    "pack",
    stage,
    "--manifest",
    join(stage, "Package.appxmanifest"),
    "--executable",
    EXE_NAME,
    "--output",
    outFile,
  ];
  if (doSign) packArgs.push("--cert", certPfx, "--cert-password", "password");
  run(winapp, packArgs, { env });

  const produced =
    (existsSync(outFile) && outFile) ||
    readdirSync(outDir)
      .filter((f) => f.endsWith(".msix"))
      .map((f) => join(outDir, f))
      .sort()
      .at(-1) ||
    outFile;

  if (doSign) {
    console.log(
      `\n${c.green("✔")} Signed MSIX ready: ${c.bold(produced)}` +
        `\n  Install it locally:` +
        `\n   1. In an ${c.bold("ADMINISTRATOR")} terminal, once — trust the dev cert:` +
        `\n      ${c.dim(`winapp cert install "${certPfx}"`)}` +
        `\n   2. Then (any terminal) install the package:` +
        `\n      ${c.dim(`Add-AppxPackage "${produced}"`)}` +
        `\n  Uninstall later: ${c.dim("Get-AppxPackage *Lumina* | Remove-AppxPackage")}\n`,
    );
  } else {
    console.log(
      `\n${c.green("✔")} MSIX ready (unsigned, Store-ready): ${c.bold(produced)}` +
        `\n  Upload it in Partner Center; the Store signs it. For a locally-installable` +
        `\n  build, re-run with ${c.dim("--sign")}. Set Identity Name/Publisher in` +
        `\n  msix/Package.appxmanifest to your Partner Center values before submitting.\n`,
    );
  }
}

try {
  main();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
