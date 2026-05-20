// TypeScript shim for the drizzle-kit generated `migrations.js`. Metro
// resolves the .js at runtime; TS picks this .d.ts for type-checking
// because it can't follow the `.sql` import inside the bundle.
//
// Regenerated migrations.js stays a sibling — do NOT delete this file
// when running `pnpm drizzle-kit generate`. The shape is stable across
// drizzle-kit versions; only update if the migrator API changes.

declare const migrations: {
  journal: {
    version: string;
    dialect: string;
    entries: Array<{
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>;
  };
  migrations: Record<string, string>;
};

export default migrations;
