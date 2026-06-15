/**
 * CLI seed (`npm run db:seed`) — runs after `prisma generate` + `prisma
 * migrate`. The actual seeding logic lives in `src/infrastructure/db/seed.ts`
 * so the packaged app's first-launch bootstrap can reuse it.
 */
import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../src/infrastructure/db/seed";

const prisma = new PrismaClient();

seedDatabase(prisma)
  .then(() => console.log("Seed complete (idempotent)."))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
