# EARTMP — Design System & Component Inventory

Companion to [`frontend-brief.md`](frontend-brief.md). This is the **component
vocabulary** for the EARTMP desktop app: design tokens, every reusable component
with its **variants and states**, and the domain-specific components the app
needs. Hand both files to the design tool so the screens it produces share one
consistent system.

> Principle: **dense but calm, trustworthy, accessible (WCAG AA), keyboard-first,
> print-aware.** Every interactive thing has hover / focus-visible / active /
> disabled / loading states. Nothing conveys meaning by color alone.

---

## 1. Design tokens

### Color (semantic, not literal — pick exact hex in design)

| Token                                          | Use                                            |
| ---------------------------------------------- | ---------------------------------------------- |
| `--bg`, `--surface`, `--surface-2`             | app background, cards, raised panels           |
| `--border`, `--border-strong`                  | dividers, input borders                        |
| `--text`, `--text-muted`, `--text-disabled`    | body, secondary, disabled                      |
| `--primary` (+ `-hover`, `-active`, `-subtle`) | brand accent, primary actions (calm deep blue) |
| `--success`                                    | verified / passed / eligible (green)           |
| `--warning`                                    | DRAFT / pending / caution (amber)              |
| `--danger` (+ `-subtle`)                       | tamper/broken, destructive, errors (red)       |
| `--info`                                       | neutral informational (slate/blue)             |
| `--focus-ring`                                 | keyboard focus outline (high contrast)         |

Institution branding is **configurable** (logo, seal, accent) — keep `--primary`
themeable. Default palette: deep blue primary, slate neutrals, single accent.

### Typography

- **App font:** clean sans (e.g. Inter). **Document font:** a serif for the
  transcript preview (official feel).
- Scale: `display / h1 / h2 / h3 / body / body-sm / caption / mono`.
- **Tabular numerals** for all scores, GPA, credits, counts.

### Spacing / radius / elevation

- 4px spacing grid (`4 8 12 16 24 32 48`).
- Radius: `sm 4 / md 8 / lg 12 / full`. Elevation: `0 / card / popover / modal`.
- Density: **compact** default for tables; comfortable for forms.

### Motion

- Fast, functional (120–200ms). Respect `prefers-reduced-motion`.

---

## 2. Foundations

- **Icon set** — one consistent line-icon family (lock, check-shield, document,
  upload, filter, warning, key, database, user, chevrons).
- **Layout primitives** — `AppShell` (sidebar + topbar + content), `Page`
  (title + actions + body), `Card`, `Section`, `Stack`/`Inline`, `Divider`,
  `ScrollArea`.
- **Grid** — responsive content area; tables get full width.

---

## 3. Navigation & chrome

| Component         | Variants / notes                                                                                                                                 | States                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **Sidebar**       | grouped nav (Dashboard, Students, Results, Transcripts, Graduation, Configuration, Administration); collapsible; **role-filtered** (hide groups) | item: default/hover/active/focus; group expanded/collapsed      |
| **Sidebar item**  | icon + label + optional count badge                                                                                                              | active (current route), disabled (no permission → with tooltip) |
| **Top bar**       | institution logo + name, global search, current user menu, **Lock** button                                                                       | —                                                               |
| **User menu**     | profile, change password, lock, sign out                                                                                                         | open/closed                                                     |
| **Breadcrumbs**   | for nested records (Students › Ada › Transcript)                                                                                                 | —                                                               |
| **Global search** | command-palette style (students by matric/name, quick actions)                                                                                   | empty / results / no-results                                    |
| **Tabs**          | within a record (Profile / Results / Transcripts)                                                                                                | selected/hover/disabled                                         |

---

## 4. Data display

| Component           | Variants / notes                                                                                            | States                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **DataTable**       | sortable headers, sticky header, row selection?, pagination, density compact; **virtualized** for big lists | loading (skeleton rows), **empty** (illustration + CTA), error, row hover/selected |
| **Pagination**      | page size + total ("1–50 of 312"), prev/next/jump                                                           | first/last disabled                                                                |
| **FilterBar**       | dropdowns (department/programme/level/status), search input, date-range, "clear"                            | active filters shown as removable chips                                            |
| **DescriptionList** | label/value pairs (student details, institution)                                                            | —                                                                                  |
| **StatBlock**       | dashboard metric (big number + label + trend/age)                                                           | loading, zero-state                                                                |
| **Timeline**        | enrollment history, transcript status history                                                               | —                                                                                  |
| **EmptyState**      | icon + message + optional action                                                                            | (generic, reusable)                                                                |
| **KeyValueGrid**    | compact 2-col facts                                                                                         | —                                                                                  |

### Status & trust components (domain-critical — design these well)

| Component                 | Values                                                               | Visual                                                              |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **StatusBadge**           | student: ACTIVE / SUSPENDED / DEFERRED / WITHDRAWN / GRADUATED       | color + label + icon; GRADUATED celebratory but restrained          |
| **TranscriptStatusBadge** | DRAFT (amber) / APPROVED (blue) / LOCKED (slate)                     | + icon                                                              |
| **LockBadge**             | result locked/unlocked                                               | padlock; locked = read-only affordance                              |
| **VerificationBadge**     | Authentic ✓ / Tampered ✗ / Unverified                                | green shield / red shield / neutral — a **trust signal**, prominent |
| **IntegrityPanel**        | audit chain: Verified ✓ (N entries) / **Broken at entry K (reason)** | green banner vs red banner with the broken index                    |
| **EligibilityVerdict**    | Eligible / Not eligible                                              | big affirmative or blocked state                                    |
| **SealedKeyIndicator**    | "Signing key sealed", "Backup encrypted"                             | quiet reassurance chip                                              |

---

## 5. Forms & inputs

All inputs: label, optional help text, **inline error**, required marker;
states **default / focus / error / disabled / readonly / loading**.

| Component                    | Notes                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TextField**                | + variants: number, search (with icon), password (reveal toggle)                                                                                          |
| **PasswordField**            | strength/policy hints (min length, number, uppercase) live-validated                                                                                      |
| **PassphraseField**          | for the operator key passphrase; reveal toggle; **"lost passphrase is unrecoverable" warning**                                                            |
| **Select / Combobox**        | searchable (programme, course, student picker)                                                                                                            |
| **MultiStepForm / Wizard**   | the **import wizard** (Upload → Validate → Commit) and admit flows; step header + back/next + can't-advance-on-error                                      |
| **NumberGrid (Score entry)** | component-score inputs (CA / Exam …) with **live computed final score**; per-field max + validation; locked → readonly                                    |
| **FileDropzone**             | .xlsx/.csv upload; drag state, file chip, size/format errors                                                                                              |
| **Toggle / Switch**          | "no outstanding fails", booleans in config                                                                                                                |
| **BandEditor**               | grade-scale bands: rows of (min–max → grade, grade point, pass?); add/remove rows; **validation: 0–100, no gaps/overlaps** with inline error highlighting |
| **WeightEditor**             | assessment components (key, label, weight, max); **weights must sum to 100** (live total indicator)                                                       |
| **ImagePicker**              | institution logo / seal / signature uploads with preview                                                                                                  |
| **RuleField**                | transcript number rule (`TR-{year}-{seq:000000}`) with a live example preview                                                                             |
| **DateRangePicker**          | audit/report filtering                                                                                                                                    |
| **FormActions**              | primary submit + cancel; disabled while invalid/saving                                                                                                    |

---

## 6. Feedback & overlays

| Component                 | Variants                                                                                        | States                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Button**                | primary / secondary / ghost / **danger** / link; sizes sm/md; icon-left/only                    | hover/focus/active/disabled/**loading (spinner)** |
| **IconButton**            | toolbar/table actions                                                                           | + tooltip                                         |
| **Dialog / Modal**        | form modal, info modal                                                                          | open/closing; focus-trapped                       |
| **ConfirmDialog**         | for irreversible actions (unlock result, delete template, **graduate**, **approve transcript**) | default + **danger** variant                      |
| **DestructiveConfirm**    | **restore backup** — requires typing a confirmation phrase; states the consequence              | typed-match enables the button                    |
| **Toast / Notification**  | success / error / info / warning; auto-dismiss + manual                                         | stack, with action ("View")                       |
| **InlineAlert / Banner**  | first-login password warning, "results unprocessed", offline notices                            | info/warning/danger/success                       |
| **Tooltip**               | hints, disabled-reason ("Requires Registrar")                                                   | —                                                 |
| **Popover / Menu**        | row actions, filters                                                                            | open/closed                                       |
| **ProgressBar / Spinner** | import progress (determinate), PDF/backup busy (indeterminate)                                  | + optional cancel                                 |
| **Skeleton**              | tables, cards, document preview                                                                 | shimmer                                           |

---

## 7. Domain-specific composite components

These are the screens' "hero" components — design them as first-class.

| Component                  | What it does                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PermissionGate**         | wraps any control; hides or disables (with reason tooltip) based on `can("perm")`. Fail-closed.                                                                                           |
| **ImportValidationReport** | table of per-row errors `{ row, messages[] }` + a summary header `{ totalRows, validRows, imported }`; "fix and re-upload" affordance; **dry-run vs commit** toggle.                      |
| **ScoreEntryCard**         | student+course context, the NumberGrid, live final score, save state, locked overlay.                                                                                                     |
| **SemesterProcessPanel**   | before→after summary of a process run (grades, GPA, credits); confirm + audited note.                                                                                                     |
| **AcademicSummaryTable**   | per-semester GPA rows + a cumulative **CGPA** footer + **standing** chip; read-only, tabular numerals.                                                                                    |
| **EligibilityChecklist**   | one row per criterion: `name · required · actual · met ✓/✗`; overall **EligibilityVerdict**; "Clear for graduation" button (enabled only if eligible).                                    |
| **TranscriptPreview (A4)** | renders the document block list on a paper-like A4 canvas: `title, fieldGrid, courseTable, summary, remarks, signatureRow, qr`; supports a **DRAFT watermark**; zoom + "export PDF/DOCX". |
| **TranscriptToolbar**      | Generate / Verify (→ VerificationBadge) / Approve / Export (PDF·DOCX) — each permission-gated and status-gated.                                                                           |
| **TemplateEditor**         | edit the layout block tree (structured panels and/or JSON) with **live TranscriptPreview** + validation errors + version bump on save.                                                    |
| **AuditLogViewer**         | filterable DataTable of audit entries + the **IntegrityPanel** ("Verify chain"); immutable (no edit/delete).                                                                              |
| **BackupPanel**            | Create backup (passphrase prompt → encrypted file) and Restore (DestructiveConfirm, verify-first).                                                                                        |
| **PassphraseDialog**       | unlock / change passphrase; old+new for rotation; unrecoverable-warning.                                                                                                                  |
| **RoleEditor**             | user → role assignment; permission preview per role.                                                                                                                                      |
| **InstitutionProfileForm** | branding (ImagePicker ×3), number rule, calendar type.                                                                                                                                    |

---

## 8. States checklist (apply to every async surface)

For each list, form, and action, design the full set:

- **Loading** (skeleton/spinner) · **Empty** (helpful, with a CTA where allowed) ·
  **Error** (retry) · **Success** · **Permission-denied** (hidden or
  disabled-with-reason) · **Read-only/locked** · **Offline** (rare, but the import
  could fail) · **In-progress with cancel** (import, backup).

## 9. Accessibility & interaction rules

- Visible **focus ring** on every focusable element; logical tab order.
- All status/trust info has **text + icon**, never color only.
- **Keyboard shortcuts:** new student, global search (`/` or Ctrl+K), save
  (Ctrl+S), table row navigation; show a shortcuts help sheet.
- Dialogs trap focus and restore it on close; Escape cancels (except typed-confirm).
- Tables: arrow-key row nav, header sort via keyboard.
- Respect `prefers-reduced-motion` and `prefers-color-scheme` (offer light/dark).

## 10. Screen → key components map (quick reference)

| Screen            | Leans on                                                                       |
| ----------------- | ------------------------------------------------------------------------------ |
| Login / Unlock    | TextField, PasswordField, PassphraseDialog, InlineAlert                        |
| Dashboard         | StatBlock, IntegrityPanel, VerificationBadge, quick-action Buttons             |
| Student list      | DataTable, FilterBar, Pagination, StatusBadge, EmptyState                      |
| Admit / Profile   | MultiStepForm, DescriptionList, Timeline, status-transition control            |
| Result entry      | ScoreEntryCard (NumberGrid), LockBadge                                         |
| Process semester  | SemesterProcessPanel, ConfirmDialog                                            |
| Import            | Wizard, FileDropzone, ImportValidationReport, ProgressBar                      |
| Academic summary  | AcademicSummaryTable, standing chip                                            |
| Transcripts       | TranscriptPreview, TranscriptToolbar, TranscriptStatusBadge, VerificationBadge |
| Template designer | TemplateEditor, TranscriptPreview, BandEditor-style panels                     |
| Graduation        | EligibilityChecklist, EligibilityVerdict, ConfirmDialog                        |
| Configuration     | BandEditor, WeightEditor, ImagePicker, RuleField, Toggle                       |
| Backup / Security | BackupPanel, DestructiveConfirm, PassphraseDialog, SealedKeyIndicator          |
| Audit             | AuditLogViewer, IntegrityPanel, DateRangePicker                                |
| Users & roles     | DataTable, RoleEditor, ConfirmDialog                                           |

---

_Pair this with `frontend-brief.md` (the product + screens + data shapes). Together
they're enough for a design tool to produce a coherent, buildable EARTMP UI whose
every component has a working backend capability behind it._
