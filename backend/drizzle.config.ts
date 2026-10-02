import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/platform/database/schema.ts",
  out: "./migrations",
});
