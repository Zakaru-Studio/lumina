// Regenerates the full application icon set from the vector master at
// src-tauri/app-icon.svg using the official Tauri icon generator.
//
// This produces PNG/ICO/ICNS plus the iOS & Android sets. Crucially, the ICO it
// writes embeds EVERY size Windows needs for a crisp taskbar / Explorer icon
// (16, 24, 32, 48, 64, 256). Do NOT hand-roll a partial ICO with only a couple
// of sizes — Windows then upscales the nearest size and the taskbar icon looks
// blank or blurry. That footgun is exactly what this script used to be.
//
// Workflow: edit src-tauri/app-icon.svg, then run:
//   node scripts/generate-icons.mjs   (or: npm run tauri icon src-tauri/app-icon.svg)
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const master = join(root, "src-tauri", "app-icon.svg");

if (!existsSync(master)) {
  console.error(`Master icon not found: ${master}`);
  process.exit(1);
}

// Run the locally-installed Tauri CLI (@tauri-apps/cli). shell:true lets Windows
// resolve npx.cmd; the master path is quoted in case it ever contains spaces.
const res = spawnSync("npx", ["tauri", "icon", `"${master}"`], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

if (res.error) {
  console.error(res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 0);
