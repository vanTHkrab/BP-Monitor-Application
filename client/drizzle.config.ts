// drizzle-kit config — used by `pnpm drizzle-kit generate` / `pnpm drizzle-kit studio`.
// Runtime code does NOT read this file; only the dev tooling does.
//
// The bundled migrations folder feeds into `src/core/database/migrator.ts`
// at app start once we add formal migrations (see README in
// src/core/database/migrations/).

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/core/database/schema.ts",
  out: "./src/core/database/migrations",
  dialect: "sqlite",
  // expo-sqlite driver: emits migrations + a bundled .js file that the
  // expo-sqlite migrator can require at runtime.
  driver: "expo",
});
