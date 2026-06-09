# Tauri-SQL Implementation Spec (for the Shell phase)

This is the hand-off spec for implementing the **production** data layer (ADR-007)
when the Tauri shell is built. Phase 7 deliberately proved the persistence
_patterns_ against the Prisma dev layer so this step is a **translation, not a
redesign**. The domain/application layers depend only on the ports below — none
of them change.

## What stays unchanged (already built)

- The repository **ports** (`src/domain/repositories/records.ts`,
  `.../index.ts`): `StudentRepository`, `CourseRepository`,
  `StudentEnrollmentRepository`, `ResultRepository`, `VersionedStudentWrites`,
  `AuditLogPort`, `TranscriptRepository`.
- The **`UnitOfWork`** port (`src/application/ports/UnitOfWork.ts`) and
  `TransactionalRepos` bundle.
- The **schema + migrations** (`prisma/migrations/`). Prisma remains the
  **dev-time** schema-authoring + migration tool (ADR-007); the generated SQL is
  what ships.

## What the shell phase implements

A parallel set of implementations under
`src/infrastructure/persistence/tauri/` (replacing the `Prisma*` dev impls at the
composition root via `wirePersistence`'s Tauri equivalent):

| Port                               | Tauri-SQL implementation                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UnitOfWork`                       | `BEGIN` → run work with repos bound to the connection → `COMMIT`; `ROLLBACK` on throw. `tauri-plugin-sql` executes raw SQL.                       |
| repositories                       | raw `SELECT/INSERT/UPDATE` against SQLite via the plugin; map rows ↔ domain entities (same mappers as the Prisma impls).                          |
| `VersionedStudentWrites.tryUpdate` | `UPDATE Student SET ..., version = version + 1 WHERE id = ? AND version = ? AND deletedAt IS NULL`; `changes() === 0` ⇒ throw `ConcurrencyError`. |
| live-row filters                   | every read appends `WHERE deletedAt IS NULL`; uniqueness uses the partial unique indexes (Phase 5).                                               |
| pagination                         | `LIMIT ? OFFSET ?` + a `COUNT(*)` for `{ items, total }`.                                                                                         |

## Migrations on the end-user machine (R-3 / F-32)

Ship the `prisma/migrations/*/migration.sql` files as app assets. On first launch,
the Tauri core applies any unapplied migrations through the plugin (a tiny
`_migrations` bookkeeping table), then opens the DB. No Prisma CLI/engine is
required at runtime.

## Encryption at rest (ADR-008)

Open the SQLite connection with SQLCipher (or the plugin's encryption), keyed via
the `KeyDerivationPort` from the `institution.encryptionSalt` setting (Phase 3).
The key is derived at unlock, never persisted.

## Acceptance (parity with Phase 7 dev layer)

Re-run the Phase 7 behaviours against the Tauri-SQL layer:

- UoW commit persists; UoW rollback discards **all** writes (F-1).
- `tryUpdate` with a stale version throws `ConcurrencyError` (F-27).
- `AdmitStudent` commits student + enrollment atomically.
- Repos honour live-row filtering + partial-unique reuse.

Because the ports are identical, the `tests/integration/persistence.integration.test.ts`
suite can be re-pointed at the Tauri-SQL `UnitOfWork`/repos as the parity check.
