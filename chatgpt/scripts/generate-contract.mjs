import { readFile, writeFile } from "node:fs/promises";

// Generate validators from the locally captured official backend contract.
const contract = JSON.parse(await readFile(new URL("../contract/openapi.json", import.meta.url)));
const components = [];
const declared = new Set();
function expression(schema) {
  if (schema.type === "null") return "z.null()";
  if (schema.const !== undefined) return `z.literal(${JSON.stringify(schema.const)})`;
  if (schema.allOf) {
    const reference = schema.allOf.find((item) => item.$ref);
    const nullable = schema.allOf.some(
      (item) => Array.isArray(item.type) && item.type.includes("null"),
    );
    if (reference && nullable) return `${expression(reference)}.nullable()`;
    throw new Error("Unsupported allOf contract");
  }
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants)
    return variants.length === 1
      ? expression(variants[0])
      : `z.union([${variants.map(expression).join(",")}])`;
  if (schema.$ref) {
    const name = schema.$ref.replace("#/components/schemas/", "");
    if (!declared.has(name)) {
      declared.add(name);
      const definition = expression(contract.components.schemas[name]);
      components.push(`const ${name}Schema = ${definition};\n`);
    }
    return `${name}Schema`;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const nullable = types.includes("null");
  const type = types.find((value) => value !== "null");
  let result;
  if (schema.enum) {
    const values = schema.enum.filter((value) => value !== null);
    result = values.every((value) => typeof value === "string")
      ? `z.enum(${JSON.stringify(values)})`
      : values.length === 1
        ? `z.literal(${JSON.stringify(values[0])})`
        : `z.union([${values.map((value) => `z.literal(${JSON.stringify(value)})`).join(",")}])`;
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
  } else throw new Error(`Unsupported contract schema: ${JSON.stringify(schema)}`);
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
  refresh: ["/api/media/{mediaId}/refresh", "post"],
  collectionStatus: ["/api/accounts/{accountId}/collection", "get"],
  collectionJob: ["/api/accounts/{accountId}/collection", "post"],
  schedule: ["/api/accounts/{accountId}/collection/schedule", "patch"],
  accountInsightCollection: ["/api/accounts/{accountId}/insights/collect", "post"],
  activity: ["/api/accounts/{accountId}/activity", "get"],
  insightHistory: ["/api/accounts/{accountId}/insights/history", "get"],
  audience: ["/api/accounts/{accountId}/audience", "get"],
  context: ["/api/media/{mediaId}/context", "get"],
  contexts: ["/api/media/context/batch", "patch"],
  business: ["/api/media/{mediaId}/business", "get"],
  businessImport: ["/api/accounts/{accountId}/business/import", "post"],
  contentAnalysis: ["/api/accounts/{accountId}/content-analysis", "get"],
  experiment: ["/api/accounts/{accountId}/experiments", "post"],
  experimentList: ["/api/accounts/{accountId}/experiments", "get"],
  experimentReport: ["/api/experiments/{experimentId}", "get"],
  storySequence: ["/api/story-sequences/{sequenceId}", "get"],
  comments: ["/api/media/{mediaId}/comments", "get"],
  commentWebhookSubscription: ["/api/accounts/{accountId}/comments/webhook/subscribe", "post"],
  commentCollection: ["/api/media/{mediaId}/comments/collect", "post"],
  erasedComments: ["/api/media/{mediaId}/comments", "delete"],
  review: ["/api/accounts/{accountId}/review", "get"],
};
let source =
  '// Generated from contract/openapi.json. Unknown response fields are stripped.\nimport { z } from "zod";\n';
for (const [name, [path, method]] of Object.entries(routes)) {
  const schema = contract.paths[path][method].responses["200"].content["application/json"].schema;
  source += `export const ${name}Response = ${expression(schema)};\n`;
}
for (const [path, operations] of Object.entries(contract.paths))
  for (const operation of Object.values(operations)) {
    const schema = operation.requestBody?.content?.["application/json"]?.schema;
    if (schema && path.startsWith("/api/") && !path.includes("/instagram/"))
      source += `export const ${operation.operationId}Input = ${expression(schema)};\n`;
  }
source = source.replace(
  'import { z } from "zod";\n',
  `import { z } from "zod";\n${components.join("")}`,
);
await writeFile(new URL("../src/contract.ts", import.meta.url), source);
