// Repository preflight: catch broken stage paths and JavaScript syntax before production.
import { readdir, readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const errors = [];
const jsFiles = [];

async function walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) { errors.push("Cannot read " + dir + ": " + error.message); return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile() && entry.name.endsWith(".js")) jsFiles.push(full);
  }
}

await walk(path.join(root, "src"));
await walk(path.join(root, "scripts"));

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    errors.push("JavaScript syntax error in " + path.relative(root, file) + ": " +
      (result.stderr || result.stdout || "node --check failed").trim());
  }
}

const pipelinePath = path.join(root, ".github", "workflows", "pipeline.yml");
try {
  const workflow = await readFile(pipelinePath, "utf8");
  const refs = [...workflow.matchAll(/\bnode\s+((?:src|scripts)\/[A-Za-z0-9_./-]+\.js)\b/g)].map(m => m[1]);
  for (const ref of [...new Set(refs)]) {
    try { await access(path.join(root, ref)); }
    catch { errors.push("Pipeline references a missing script: " + ref); }
  }
  if (!refs.length) errors.push("No Node.js stage commands were found in pipeline.yml.");
} catch (error) {
  errors.push("Cannot read pipeline.yml: " + error.message);
}

if (errors.length) {
  console.error("Repository preflight FAILED (" + errors.length + " issue(s)):");
  for (const error of errors) console.error("- " + error);
  process.exit(1);
}
console.log("Repository preflight passed: " + jsFiles.length + " JavaScript files checked; all pipeline script paths exist.");
