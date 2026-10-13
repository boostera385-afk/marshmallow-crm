const fs = require("fs");
const src = fs.readFileSync("src/data/service-options.ts", "utf8");
const names = new Set();
const re = /services:\s*\[([\s\S]*?)\]/g;
let m;
while ((m = re.exec(src))) {
  const q = /"((?:[^"\\]|\\.)*)"/g;
  let x;
  while ((x = q.exec(m[1]))) names.add(JSON.parse('"' + x[1] + '"'));
}
const list = [...names].sort();
const out =
  "// Generated from src/data/service-options.ts. Regenerate with scripts/gen-service-list.cjs.\n" +
  "// Used by edge functions to validate AI service_type suggestions.\n" +
  "export const SERVICE_NAMES: readonly string[] = " + JSON.stringify(list, null, 1) + ";\n\n" +
  "const LOWER = new Map(SERVICE_NAMES.map((n) => [n.toLowerCase(), n]));\n" +
  "/** Returns the canonical service name for a case-insensitive match, else null. */\n" +
  "export function canonicalService(value: string): string | null {\n" +
  "  return LOWER.get(value.trim().toLowerCase()) ?? null;\n}\n";
fs.writeFileSync("supabase/functions/_shared/service-names.ts", out);
console.log("services:", list.length);
