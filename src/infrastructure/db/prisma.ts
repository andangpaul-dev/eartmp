/**
 * PrismaClient singleton.
 *
 * The single point of database access for the whole application. Every
 * Prisma-backed repository (added from Phase 7) receives this instance via the
 * DI composition root; no other module instantiates a client. A module-level
 * singleton avoids exhausting SQLite connections during dev hot-reloads.
 *
 * Requires the generated Prisma client (`npx prisma generate`). It is isolated
 * in the infrastructure layer so the domain/application layers never depend on
 * it. Instantiation is lazy so importing the DI module does not open a
 * connection until the database is actually used.
 */
import { PrismaClient } from "@prisma/client";

let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!client) client = new PrismaClient();
  return client;
}
