# EARTMP — Frontend ⇄ Core Integration Handoff

**The core is done; the desktop shell is not.** This package connects the
**design prototype** to the **finished headless core** as the app's
`src/presentation/` layer.

- Core: Tauri 2 + React 19 + TS, offline-first on SQLite, hexagonal. All phases
  complete, 271 tests. `src/presentation/` is the placeholder where the UI lives,
  depending on application use-cases **through the IPC façade** — never touching
  infrastructure or the DB directly.
- Prototype (`../EARTMP.dc.html`): faithful clickable spec; data mocked.
- This package: the typed seam between them, reconciled to the **real** use-cases.

---

## 1. Architecture you're plugging into

Hexagonal. Each screen calls an **application use-case behind a port**. Every
use-case implements `AuthorizedUseCase<I,O>` — it declares `requiredPermissions`
(or `isPublic` / `authenticatedOnly`) and is executed **only** through one gate:

```ts
authorize(useCase, input, session); // fail-closed, default-deny (ADR-011)
```

Identity is the `SessionContext` built at login from the user's role; use-cases
read permissions off it. The UI cannot assert its own privileges (F-16).

### Host / webview split (the repo enforces it)

`tests/architecture.test.ts` forbids the webview from importing
`src/infrastructure/**` or the DI container. So:

```
React UI ─► CoreApi (ipcClient) ─► 1 Tauri command ─► HOST dispatcher
 (pure webview)                                          │ authorize(uc, input, session)
                                                         ▼ DI container → use-case → repo → SQLite
```

- **Webview** (`src/presentation/**`): pure — types, `CoreApi` client, React hooks.
- **Host** (`src/host/dispatcher.ts`): trusted — owns `SessionContext`, resolves the
  use-case, runs `authorize`. Returns a serializable `{ ok, data | error }` envelope.

This is why the package does **not** re-implement permissions: the core's gate is the
boundary. The UI only _reads_ `SessionView.permissions` to hide/disable controls.

---

## 2. The real mapping — screen → use-case (`.name`) → input → permission

Verb = `CoreApi` method (webview). Class = core use-case `.name` (host resolves it).
Permission is declared **on the use-case** in the core (shown for UI gating only).

### Auth & session _(host-owned lifecycle)_

| UI                 | Verb               | Use-case `.name`                     | Input                 | Perm                 |
| ------------------ | ------------------ | ------------------------------------ | --------------------- | -------------------- |
| Login              | `login`            | `AuthenticateUser` (isPublic)        | `{username,password}` | —                    |
| Resume             | `currentUser`      | — (host session)                     | —                     | —                    |
| Lock/sign out      | `logout`           | — (host session)                     | —                     | —                    |
| Change password    | `changePassword`   | `ChangePassword` (authenticatedOnly) | `{...}`               | —                    |
| Unlock signing key | `unlockSigningKey` | `ChangeKeyPassphrase` ⚠              | `{passphrase}`        | `security.manage`? ⚠ |

### Students

| UI                      | Verb                  | `.name`               | Input                                                                | Perm              |
| ----------------------- | --------------------- | --------------------- | -------------------------------------------------------------------- | ----------------- |
| List (filter/paginate)  | `listStudents`        | `ListStudents`        | `StudentQuery {where?,skip?,take?}` → `Page<Student>`                | `students.read`   |
| Profile                 | `getStudent`          | `GetStudent`          | `{id}`                                                               | `students.read`   |
| Admit (atomic + enroll) | `admitStudent`        | `AdmitStudent`        | `{matricNumber,fullName,regNumber?,programmeId,levelId,fromSession}` | `students.create` |
| Edit                    | `updateStudent`       | `UpdateStudent`       | `{id,patch}`                                                         | `students.update` |
| Status transition       | `changeStudentStatus` | `ChangeStudentStatus` | `{studentId,to}`                                                     | `students.update` |

> Status: core enforces the matrix via `canTransition` + `StudentRules.isFinalized`
> (GRADUATED/WITHDRAWN are final). The UI mirrors `canTransition` to offer only legal
> targets — see `StudentsScreen.tsx`.

### Results

| UI                       | Verb                        | `.name`                     | Input                                               | Perm              |
| ------------------------ | --------------------------- | --------------------------- | --------------------------------------------------- | ----------------- |
| Score entry (live final) | `enterResult`               | `EnterResult`               | `{studentId,courseId,semesterId,componentScores[]}` | `results.process` |
| Read semester            | `getStudentSemesterResults` | `GetStudentSemesterResults` | `{studentId,semesterId}`                            | `results.read`    |
| Process semester         | `processSemester`           | `ProcessSemester`           | `ProcessSemesterUseCaseInput`                       | `results.process` |
| Lock semester            | `lockSemesterResults`       | `LockSemesterResults`       | `{studentId,semesterId}`                            | `results.process` |
| Unlock one result        | `unlockResult`              | `UnlockResult`              | `{resultId}`                                        | `results.unlock`  |

> `EnterResult` computes the final score via the configured assessment structure and
> **dedupes** on (student, course, semester) — re-entry updates, never duplicates; a
> locked result refuses edits. The UI shows the live final but the **core is authoritative**.

### Import (flagship)

| UI                      | Verb                          | `.name`         | Input → Output                              | Perm             |
| ----------------------- | ----------------------------- | --------------- | ------------------------------------------- | ---------------- |
| Validate / dry-run      | `importResults` (dryRun:true) | `ImportResults` | `{semesterId,rows,dryRun}` → `ImportReport` | `results.import` |
| Commit (all-or-nothing) | `importResults`               | `ImportResults` | `{semesterId,rows}` → `ImportReport`        | `results.import` |

> One use-case; `dryRun` distinguishes validate vs commit. `ImportReport.errors[]` is
> `{row, messages[]}`. It takes **already-parsed rows** — parse the workbook on the host
> (or add a host command that takes a file path) so 100k-row files don't cross IPC as a
> giant array. Commit is one transaction; any error ⇒ nothing writes.

### Academic summary & transcripts

| UI         | Verb                 | `.name`              | Input → Output                                                       | Perm                   |
| ---------- | -------------------- | -------------------- | -------------------------------------------------------------------- | ---------------------- |
| Summary    | `getAcademicSummary` | `GetAcademicSummary` | `{studentId}` → `AcademicSummary` (cgpa, standing)                   | `results.read`         |
| Generate   | `generateTranscript` | `GenerateTranscript` | `{studentId,type?,templateId?}` → `StoredTranscript` (DRAFT, number) | `transcripts.generate` |
| **Verify** | `verifyTranscript`   | `VerifyTranscript`   | `{transcriptId}` → `{valid,transcriptNumber}`                        | `transcripts.read`     |
| Approve    | `approveTranscript`  | `ApproveTranscript`  | `{transcriptId}` → `StoredTranscript`                                | `transcripts.approve`  |
| Export     | `exportTranscript`   | `ExportTranscript`   | `{transcriptId,preview?}` → `{bytes,filename,contentType}`           | `transcripts.read`     |

> CGPA is an **aggregate of stored grade points** — display to 2 dp, never recompute.
> Verify checks the **Ed25519 signature** of the frozen snapshot (tamper ⇒ invalid) —
> surface the green check prominently. Official export needs APPROVED/LOCKED; a DRAFT
> `preview:true` returns a **watermarked** doc. Bytes are `Uint8Array` — base64 across IPC.

### Graduation

| UI                   | Verb                 | `.name`              | Input → Output                      | Perm               |
| -------------------- | -------------------- | -------------------- | ----------------------------------- | ------------------ |
| Eligibility report   | `evaluateGraduation` | `EvaluateGraduation` | `{studentId}` → `EligibilityReport` | `graduation.read`  |
| Clear for graduation | `graduateStudent`    | `GraduateStudent`    | `{studentId}` → `{status,report}`   | `graduation.clear` |

> `GraduateStudent` **re-evaluates** at clearance (never trusts a stale report), then
> transitions ACTIVE → GRADUATED via `canTransition`. Audited.

### Audit

| UI                    | Verb               | `.name`            | Input → Output                                 | Perm         |
| --------------------- | ------------------ | ------------------ | ---------------------------------------------- | ------------ |
| Log (filter/paginate) | `getAuditLog`      | `GetAuditLog`      | `AuditQuery` → `Page<AuditEntry>`              | `audit.read` |
| Verify chain          | `verifyAuditChain` | `VerifyAuditChain` | `{}` → `ChainVerification {valid,…,brokenAt?}` | `audit.read` |

> Append-only — **no edit/delete UI**. `AuditQuery` filters: `actorId, entity, action,
from, to, skip, take`.

### Configuration (second pass)

`ListGradeScales`, `ListAssessmentConfigs` (read) are stubbed in `USE_CASE`. Expand from
`ManageGradeScales` / `ManageAssessmentConfigs` / `ManageInstitution` / `ManageSettings`
for §5.8 + the template designer. One **default** each; default/in-use can't be deleted.

---

## 3. Required states & rules the UI must implement (prototype mocks these)

- Every read: **loading / empty / error / data** — all four (see `useAsync`).
- Status & trust **badges**: color **+ label + icon** (student status, `isLocked`,
  transcript DRAFT/APPROVED/LOCKED, audit Verified/Broken).
- **Fail-closed gating**: `can('perm')` hides/disables; the gate blocks; the core re-checks.
- **Destructive/irreversible** (unlock result, graduate, approve, restore backup) → confirm
  dialog stating the consequence; restore needs a typed confirmation.
- **Errors**: `CoreError.code` drives messages — `CONFLICT` (dup matric), `LOCKED`,
  `FORBIDDEN`, `UNAUTHENTICATED`, `VALIDATION` (+ `.fields` for forms).
- Domain rules already enforced by the core (mirror in UX, don't reimplement): locked
  result immutable w/o audited unlock · official export only APPROVED/LOCKED · CGPA
  aggregate/2 dp · status matrix · lost passphrase unrecoverable.

---

## 4. The wiring pattern (copy for every screen)

```tsx
const core = useCore();
const { can } = useSession();

const list = useAsync(
  () => core.listStudents({ where, skip, take }),
  [where, skip],
);

{
  can("students.create") && <button onClick={openAdmit}>Admit student</button>;
}

const approve = useAction(() => core.approveTranscript({ transcriptId: id }), {
  onSuccess: () => {
    toast("Approved");
    list.reload();
  },
});

// render: list.loading / list.error / empty / data — always all four
```

Full example: `src/presentation/screens/StudentsScreen.tsx`.

---

## 5. ⚠ Reconciliation checklist (do before building screens)

1. **`USE_CASE` names** (`contract.ts`) vs the core class `.name`s. Confirm
   `unlockSigningKey` → `ChangeKeyPassphrase` vs a dedicated key-unseal op, and whether
   it's an authorized use-case or a host security-port call.
2. **DI tokens**: the dispatcher resolves by `.name`; match your `buildContainer()` keys.
3. **Errors** (`errors.ts › toErrorEnvelope`) vs `src/domain/errors/**` class names +
   messages (`already in use` ⇒ CONFLICT, `locked` ⇒ LOCKED).
4. **Typed `unknown`s**: give `ProcessSemester` and the config reads their real return
   types in `contract.ts`.
5. **Binary export**: decide base64 vs host-writes-file for `exportTranscript` bytes.
6. **Import rows**: parse on host; confirm `RawRow` column keys match the spreadsheet.

---

## 6. Order of work

1. Reconcile §5 → green types.
2. Copy `src/presentation/**` + `src/host/dispatcher.ts`; register use-cases in the
   container; add the `execute_use_case` command.
3. Shell (sidebar/topbar) + routing + `CoreProvider` + login/unlock. _(Prototype done.)_
4. **Students** (reference screen) → proves the pattern end-to-end.
5. Results + **Import** → Summary + Transcripts + A4 → Graduation → Audit.
6. Config + template designer + admin (users/security/backup) — second pass.
