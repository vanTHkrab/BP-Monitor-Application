import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit only generates migrations here — it never connects to a device
 * database. `driver: 'expo'` makes it emit the migrations.js bundle that
 * `useMigrations` (drizzle-orm/expo-sqlite/migrator) applies on app start.
 *
 * Regenerate with: pnpm drizzle-kit generate
 */
export default {
  schema: './src/database/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'expo',
} satisfies Config;
