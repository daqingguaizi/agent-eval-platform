import fs from "node:fs";
import path from "node:path";

const ENV_FILE = path.resolve(import.meta.dirname, "..", ".env.local");

export function loadEvaluationEnvironment() {
  let source: string;
  try {
    source = fs.readFileSync(ENV_FILE, "utf8");
  } catch {
    return;
  }
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^("|')|("|')$/g, "");
    if (process.env[key] !== undefined && !key.startsWith("ECHO_PILOT_")) continue;
    process.env[key] = value;
  }
}
