import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node dist-seed/seed.js",
  },
  datasource: {
    url: process.env["DATABASE_URL"] as string,
  },
});
