#!/usr/bin/env node
/**
 * Lumina release automation (Windows, local).
 *
 * Usage:
 *   node scripts/release.mjs <version> [release notes]
 *   e.g. node scripts/release.mjs 0.2.0 "Trash-aware delete, sidebar counts."
 *
 * What it does, in order:
 *   1. Validates preconditions (clean git tree, signing key, upload config, semver).
 *   2. Bumps the version in package.json, package-lock.json, tauri.conf.json
 *      and Cargo.toml.
 *   3. Builds a SIGNED Windows NSIS installer (`tauri build --bundles nsis`),
 *      producing the `-setup.exe` and its `.sig` updater artifact.
 *   4. Writes `latest.json` (the updater manifest the app polls) pointing at the
 *      self-hosted download URL.
 *   5. Commits the bump, tags `v<version>`, pushes branch + tag to the (private)
 *      code repo.
 *   6. Uploads the installer + latest.json to the self-hosted update host over
 *      SSH (key auth) so installed apps can fetch them publicly.
 *   7. Best-effort: also publishes a GitHub Release with the installer attached
 *      (skipped, never failed, when gh is unavailable/unauthenticated).
 *
 * Secrets come from a gitignored `.env.release` at the repo root:
 *   LUMINA_SIGNING_KEY_PATH=<path to the updater private key>
 *   TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<its password>
 *   LUMINA_UPDATE_BASE_URL=<public https base serving the two files>
 *   LUMINA_SSH_HOST / LUMINA_SSH_USER / LUMINA_SSH_KEY / LUMINA_SSH_REMOTE_DIR
 * The updater public key is committed in `tauri.conf.json`, whose `endpoints`
 * must point at `<LUMINA_UPDATE_BASE_URL>/latest.json`. See README "Releasing".
 *
 * Node built-ins only — no extra dependencies (uses the system `scp`).
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_TAURI = join(ROOT, "src-tauri");

/** ANSI helpers for readable output. */
const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const step = (msg) => console.log(`\n${c.cyan("▶")} ${c.bold(msg)}`);
const info = (msg) => console.log(`  ${c.dim(msg)}`);
function fail(msg) {
  console.error(`\n${c.red("✖")} ${msg}\n`);
  process.exit(1);
}

/** Run a command, inheriting stdio; throws (caught → fail) on non-zero exit. */
function run(cmd, args, opts = {}) {
  // `shell: true` hands the joined command to the platform shell, which re-parses
  // on whitespace — so any arg containing spaces (a commit message, release
  // notes) must be quoted or it splits into multiple tokens.
  const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  const res = spawnSync(cmd, quoted, { stdio: "inherit", shell: true, cwd: ROOT, ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${res.status}`);
}
/** Run a command and capture trimmed stdout. */
function capture(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", shell: true, ...opts }).trim();
}

/** Parse a strict `major.minor.patch` string into numbers, or null. */
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
/** Return true when `a` is strictly greater than `b` (both parsed triples). */
function gt(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Load `.env.release` into a plain object (KEY=VALUE lines, `#` comments). */
function loadEnvRelease() {
  const path = join(ROOT, ".env.release");
  if (!existsSync(path)) {
    fail(
      ".env.release not found. Create it with LUMINA_SIGNING_KEY_PATH and " +
        "TAURI_SIGNING_PRIVATE_KEY_PASSWORD (see README “Releasing”).",
    );
  }
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

/** Derive `owner/repo` from the first github remote. */
function resolveRepoSlug() {
  const remotes = capture("git", ["remote"]).split(/\r?\n/).filter(Boolean);
  const preferred = remotes.includes("origin") ? "origin" : remotes[0];
  if (!preferred) fail("No git remote configured.");
  const url = capture("git", ["remote", "get-url", preferred]);
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!m) fail(`Could not parse a GitHub owner/repo from remote URL: ${url}`);
  return m[1];
}

/** Read/replace the `version` in a JSON file at one or more key paths. */
function bumpJson(relPath, version, keyPaths) {
  const path = join(ROOT, relPath);
  const json = JSON.parse(readFileSync(path, "utf8"));
  for (const keys of keyPaths) {
    let node = json;
    for (let i = 0; i < keys.length - 1; i++) node = node?.[keys[i]];
    if (node && keys.at(-1) in node) node[keys.at(-1)] = version;
  }
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  info(`bumped ${relPath}`);
}

/** Replace the first `version = "..."` (the [package] version) in Cargo.toml. */
function bumpCargoToml(version) {
  const path = join(SRC_TAURI, "Cargo.toml");
  const text = readFileSync(path, "utf8");
  const next = text.replace(/^version = "[^"]+"/m, `version = "${version}"`);
  if (next === text) fail("Could not find the [package] version line in Cargo.toml");
  writeFileSync(path, next);
  info("bumped src-tauri/Cargo.toml");
}

async function main() {
  const version = process.argv[2];
  const notes = process.argv[3] || "";
  if (!version) fail("Usage: node scripts/release.mjs <version> [release notes]");

  const parsed = parseSemver(version);
  if (!parsed) fail(`Invalid version "${version}". Expected major.minor.patch (e.g. 0.2.0).`);

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const current = parseSemver(pkg.version);
  if (current && !gt(parsed, current)) {
    fail(`New version ${version} must be greater than current ${pkg.version}.`);
  }

  // --- Preconditions -------------------------------------------------------
  step("Checking preconditions");

  if (capture("git", ["status", "--porcelain"])) {
    fail("Working tree is not clean. Commit or stash your changes first.");
  }
  info("git working tree clean");

  const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  info(`on branch ${branch}`);

  const tag = `v${version}`;
  const existingTags = capture("git", ["tag", "--list", tag]);
  if (existingTags) fail(`Tag ${tag} already exists.`);

  const secrets = loadEnvRelease();
  const keyPath = secrets.LUMINA_SIGNING_KEY_PATH;
  const keyPassword = secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  if (!keyPath || !existsSync(keyPath)) {
    fail(`Signing key not found at LUMINA_SIGNING_KEY_PATH=${keyPath ?? "(unset)"}.`);
  }
  if (!keyPassword) fail("TAURI_SIGNING_PRIVATE_KEY_PASSWORD is not set in .env.release.");
  const privateKey = readFileSync(keyPath, "utf8");
  info("signing key loaded");

  // Self-hosted distribution: the public HTTPS base URL that serves the
  // installer + latest.json (must match the updater endpoint baked into the app),
  // and the command used to upload the two files there.
  const baseUrl = (secrets.LUMINA_UPDATE_BASE_URL || "").replace(/\/+$/, "");
  const sshHost = secrets.LUMINA_SSH_HOST || "";
  const sshUser = secrets.LUMINA_SSH_USER || "";
  const sshKey = secrets.LUMINA_SSH_KEY || "";
  const remoteDir = secrets.LUMINA_SSH_REMOTE_DIR || ""; // "" = the account's home dir
  if (!baseUrl || !sshHost || !sshUser || !sshKey) {
    fail(
      "Self-hosting needs LUMINA_UPDATE_BASE_URL, LUMINA_SSH_HOST, LUMINA_SSH_USER " +
        "and LUMINA_SSH_KEY in .env.release.",
    );
  }
  if (!existsSync(sshKey)) fail(`SSH deploy key not found at LUMINA_SSH_KEY=${sshKey}.`);
  info(`update host ${baseUrl} (scp to ${sshUser}@${sshHost})`);

  // A GitHub Release is also published, in addition to self-hosting. Best-effort:
  // the repo slug comes from the git remote, and publishing is skipped (never
  // failed) when gh is unavailable/unauthenticated.
  const repo = resolveRepoSlug();
  const ghReady =
    spawnSync("gh", ["auth", "status"], { shell: true, cwd: ROOT, stdio: "ignore" }).status === 0;
  info(ghReady ? `github ${repo} (release will be published)` : `github ${repo} (gh not authed → release skipped)`);

  // --- Version bump --------------------------------------------------------
  step(`Bumping version to ${version}`);
  bumpJson("package.json", version, [["version"]]);
  bumpJson("package-lock.json", version, [["version"], ["packages", "", "version"]]);
  bumpJson("src-tauri/tauri.conf.json", version, [["version"]]);
  bumpCargoToml(version);

  // --- Build signed installer ---------------------------------------------
  step("Building signed Windows installer (this takes several minutes)");
  const cargoBin = process.env.USERPROFILE ? join(process.env.USERPROFILE, ".cargo", "bin") : "";
  const buildEnv = {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: privateKey,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: keyPassword,
    PATH: cargoBin ? `${process.env.PATH};${cargoBin}` : process.env.PATH,
  };
  run("npx", ["--no-install", "tauri", "build", "--bundles", "nsis"], { env: buildEnv });

  // --- Locate artifacts ----------------------------------------------------
  step("Locating updater artifacts");
  const nsisDir = join(SRC_TAURI, "target", "release", "bundle", "nsis");
  if (!existsSync(nsisDir)) fail(`NSIS output directory missing: ${nsisDir}`);
  const files = readdirSync(nsisDir);
  // Match THIS version's installer specifically — stale artifacts from earlier
  // builds can linger in the bundle dir, and a bare `-setup.exe` match would
  // silently pick the wrong (older) one.
  const setupExe = files.find((f) => f.includes(`_${version}_`) && f.endsWith("-setup.exe"));
  const setupSig = setupExe ? files.find((f) => f === `${setupExe}.sig`) : undefined;
  if (!setupExe) fail(`Could not find Lumina_${version}_*-setup.exe in the NSIS output.`);
  if (!setupSig) {
    fail("Could not find the *-setup.exe.sig signature. Is createUpdaterArtifacts enabled?");
  }
  const setupPath = join(nsisDir, setupExe);
  const signature = readFileSync(join(nsisDir, setupSig), "utf8").trim();
  info(`installer: ${setupExe}`);

  // --- Updater manifest ----------------------------------------------------
  step("Writing latest.json");
  const downloadUrl = `${baseUrl}/${encodeURIComponent(setupExe)}`;
  const manifest = {
    version,
    notes: notes || `Lumina ${version}`,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": { signature, url: downloadUrl },
    },
  };
  const manifestPath = join(nsisDir, "latest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  info(`manifest: ${manifestPath}`);

  // --- Commit, tag, push ---------------------------------------------------
  step("Committing and tagging");
  run("git", [
    "add",
    "package.json",
    "package-lock.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
  ]);
  run("git", ["commit", "-m", `Release ${tag}`]);
  run("git", ["tag", tag]);
  run("git", ["push", "origin", branch]);
  run("git", ["push", "origin", tag]);

  // --- Publish to the self-hosted update host ------------------------------
  step("Staging release artifacts");
  const distDir = join(ROOT, "release-dist");
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  copyFileSync(setupPath, join(distDir, setupExe));
  copyFileSync(manifestPath, join(distDir, "latest.json"));
  info(`staged ${setupExe} + latest.json in ${distDir}`);

  step("Uploading to the update host (scp)");
  const target = `${sshUser}@${sshHost}:${remoteDir}`;
  info(`scp → ${sshUser}@${sshHost}:${remoteDir || "<home>"}`);
  // No shell: pass file args directly so spaces/globs never bite. Key auth only.
  const scp = spawnSync(
    "scp",
    [
      "-i", sshKey,
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=30",
      join(distDir, setupExe),
      join(distDir, "latest.json"),
      target,
    ],
    { stdio: "inherit", cwd: ROOT },
  );
  if (scp.status !== 0) fail("scp upload to the update host failed.");

  // --- GitHub Release (best-effort, in addition to self-hosting) -----------
  // Publishes the installer on the repo's Releases page for visibility / manual
  // download. The updater still uses the self-hosted latest.json above; a
  // failure here never aborts the release (core steps already succeeded).
  step("Creating GitHub Release");
  if (ghReady) {
    try {
      const notesArgs = notes ? ["--notes", notes] : ["--generate-notes"];
      run("gh", [
        "release", "create", tag,
        setupPath,
        join(nsisDir, setupSig),
        "--repo", repo,
        "--title", `Lumina ${version}`,
        ...notesArgs,
      ]);
      info(`published ${tag} to github.com/${repo}/releases`);
    } catch (e) {
      info(`skipped GitHub Release (${e.message}); self-host upload already succeeded`);
    }
  } else {
    info("skipped GitHub Release (gh not authenticated — run `gh auth login` to enable)");
  }

  console.log(
    `\n${c.green("✔")} Released ${c.bold(tag)}. ` +
      `Installed apps will detect it via ${c.dim(baseUrl + "/latest.json")}.\n`,
  );
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
