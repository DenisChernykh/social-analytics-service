import { readFile, writeFile } from "node:fs/promises";

// Generate validators only for the official backend contract captured on 2026-10-02.
const contract = JSON.parse(await readFile(new URL("../contract/openapi.json", import.meta.url)));
function expression(schema) {
  if (schema.$ref) {
    const name = schema.$ref.replace("#/components/schemas/", "");
    return expression(contract.components.schemas[name]);
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const nullable = types.includes("null");
  const type = types.find((value) => value !== "null");
  let result;
  if (schema.enum) {
    const values = schema.enum.filter((value) => value !== null);
    result = `z.enum(${JSON.stringify(values)})`;
  } else if (type === "object") {
    if (schema.properties) {
      result = `z.object({${Object.entries(schema.properties)
        .map(
          ([key, value]) =>
            `${JSON.stringify(key)}:${expression(value)}${schema.required?.includes(key) ? "" : ".optional()"}`,
        )
        .join(",")}})`;
    } else if (typeof schema.additionalProperties === "object") {
      result = `z.record(z.string(),${expression(schema.additionalProperties)})`;
    } else throw new Error("Unspecified object contract");
  } else if (type === "array") result = `z.array(${expression(schema.items)})`;
  else if (type === "boolean") result = "z.boolean()";
  else if (type === "number" || type === "integer") {
    result = type === "integer" ? "z.number().int()" : "z.number()";
    if (schema.minimum !== undefined) result += `.min(${schema.minimum})`;
    if (schema.maximum !== undefined) result += `.max(${schema.maximum})`;
  } else if (type === "string") {
    result = "z.string()";
    if (schema.minLength !== undefined) result += `.min(${schema.minLength})`;
    if (schema.maxLength !== undefined) result += `.max(${schema.maxLength})`;
    if (schema.format === "uuid") result += ".uuid()";
    if (schema.format === "uri") result += ".url()";
  } else throw new Error(`Unsupported contract type: ${type}`);
  return result + (nullable ? ".nullable()" : "");
}
const routes = {
  accounts: ["/api/accounts", "get"],
  search: ["/api/media", "get"],
  resolve: ["/api/reports/media", "get"],
  media: ["/api/media/{mediaId}", "get"],
  report: ["/api/media/{mediaId}/statistics", "get"],
  history: ["/api/media/{mediaId}/history", "get"],
  benchmark: ["/api/media/{mediaId}/benchmark", "get"],
  summary: ["/api/accounts/{accountId}/summary", "get"],
  accountHistory: ["/api/accounts/{accountId}/history", "get"],
  sync: ["/api/accounts/{accountId}/sync", "post"],
  metrics: ["/api/metrics", "get"],
};
let source =
  '// Generated from contract/openapi.json. Unknown response fields are stripped.\nimport { z } from "zod";\n';
for (const [name, [path, method]] of Object.entries(routes)) {
  const schema = contract.paths[path][method].responses["200"].content["application/json"].schema;
  source += `export const ${name}Response = ${expression(schema)};\n`;
}
await writeFile(new URL("../src/contract.ts", import.meta.url), source);
