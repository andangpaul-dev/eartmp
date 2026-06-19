# Faculty‑scoped RBAC & oversight — design

_Workstream A of the 9‑item upgrade set (items 5, 6, 8, 9). Date: 2026‑06‑19._

## Goal

Let users be scoped to one or more **faculties/schools** so they see and act on
only those faculties' students, results, records and transcripts — while
**Registrar** oversees all academic processes institution‑wide and **Admin**
configures everything. Records and transcripts become browsable per
faculty → department → programme.

This extends the existing **institution scoping** (Phase F): sessions already
carry `institutionId` and queries are filtered by it. Faculty scoping is the
next layer down, built with the same helpers.

## Decisions (confirmed)

- **Multiple faculties per user** — a user may be assigned several faculties and
  sees their union. Needs a `User ↔ Faculty` join table.
- **Orthogonal assignment + a new role.** Role = WHAT a user can do; faculty
  assignment = WHICH faculties' data. Any user may be assigned faculties (empty
  = institution‑wide). PLUS a dedicated, faculty‑scoped **`FACULTY_OFFICER`**
  role for the common case.
- **Registrar / Admin are institution‑wide** (left unassigned), but the model
  still allows assigning anyone faculties.

## Data model

- **New table `UserFaculty`** — `(userId, facultyId)`, unique pair, FKs to
  `User` and `Faculty`. A user's assigned faculties. No rows = unscoped.
- **`SessionContext`** gains `facultyIds: string[]` next to `institutionId`,
  populated at login from `UserFaculty`. Empty ⇒ unscoped (sees everything
  within its institution scope). Add an `isFacultyScoped` getter
  (`facultyIds.length > 0`).
- **New seeded role `FACULTY_OFFICER`** (idempotent seed so existing DBs gain it
  on relaunch — same pattern as built‑in templates).
- **No change to `Student` / `Transcript`** — both already carry a denormalized
  `facultyId`, so scoping is a cheap `WHERE facultyId IN (…)`.

## Enforcement — extend `application/authorization/institutionScope.ts`

One place, consistent with Phase F. The institution filter still applies; the
faculty filter is layered on top only when the session is faculty‑scoped.

- **Reads:** `scopeWhere(where, session)` additionally constrains
  `facultyId ∈ session.facultyIds` when non‑empty. Applies to students, results,
  records, transcripts list queries.
- **Writes:** new `requireInFacultyScope(rowFacultyId, session)` (mirrors
  `requireInScope`) — throws `AuthorizationError` ("This record belongs to
  another faculty.") if a scoped user targets a faculty outside their set. Used
  by admit/update/delete student, enter result, generate transcript/certificate.
  A new student's `facultyId` is derived from the chosen programme's faculty.
- **Unscoped sessions** (empty `facultyIds`) are unaffected ⇒ fully
  backward‑compatible.

## Roles & oversight (#8 / #9) — permission sets

- **ADMIN (SUPER_ADMIN):** everything — config, security, users, structure, all
  academic. (unchanged)
- **REGISTRAR:** all **academic** processes institution‑wide — students, results
  processing, transcripts/certificates, graduation, structure read. Not
  faculty‑scoped by convention. (≈ today)
- **FACULTY_OFFICER (new):** read students/results/records/transcripts, enter
  results, generate transcripts/certificates — **only within assigned
  faculties**. No structure/users/config/security.
- **DATA_ENTRY / VIEWER:** as today, but now also honor any faculty assignment.

## Records & transcripts per faculty/dept/programme (#6)

- The **Records** and **Transcripts** lists gain cascading filters
  faculty → department → programme.
- For a faculty‑scoped user the faculty filter is **pre‑constrained** to their
  assigned faculties and **cannot be widened** beyond them; for Registrar/Admin
  the filters are free across the institution.
- The security boundary is server‑side `scopeWhere` (a scoped user cannot query
  outside their faculties even by crafting a request); the UI filter is
  convenience.

## UI

- **Users screen:** create/edit user form gains a **"Faculty access"**
  multi‑select; empty = institution‑wide. Gated `users.manage`. New host method
  `setUserFaculties(userId, facultyIds)`; the user list shows each user's
  faculties (and "All" when unassigned). `FACULTY_OFFICER` appears in the role
  picker.
- **Scoped lists** (Students, Records, Transcripts) show only in‑scope rows
  automatically, with a small "Showing: <faculties>" hint when scoped.

## Migration & backward‑compatibility

- Additive migration: create `UserFaculty` (unique `(userId, facultyId)`).
- Idempotent bootstrap step seeds the `FACULTY_OFFICER` role + its permissions
  (so existing databases gain it on relaunch).
- Existing users have no `UserFaculty` rows ⇒ unscoped ⇒ behavior unchanged. The
  default admin stays global.

## Contract / host additions

- `setUserFaculties({ userId, facultyIds })` — gated `users.manage`,
  institution‑scope guarded.
- `listUsers` returns each user's `facultyIds` (or names) for display.
- Login (`AuthenticateUser`) resolves and attaches `facultyIds` to the session.

## Testing

- **Domain/use‑case:** `scopeWhere` / `requireInFacultyScope` for single‑,
  multi‑faculty and empty (unscoped) sessions; a Faculty Officer cannot read or
  write another faculty's student; a Registrar (unassigned) sees all.
- **Auth:** login carries `facultyIds` onto the session.
- **UI:** Users‑screen assignment calls `setUserFaculties`; records/transcripts
  filters respect (and can't exceed) scope.

## Out of scope (this workstream)

Structure management by faculty officers; and the results/resit (B), admission +
matricule (C), and editable‑grading (D) workstreams.
