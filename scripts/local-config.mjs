import { readFile } from "node:fs/promises";

export const variablesPath = new URL("../backend/.dev.vars", import.meta.url);
export async function readLocalConfig() {
  let source;
  try {
    source = await readFile(variablesPath, "utf8");
  } catch {
    return {};
  }
  const values = {};
  for (const line of source.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    const value = match[2].trim();
    values[match[1]] = value.startsWith('"') ? JSON.parse(value) : value;
  }
  return values;
}
