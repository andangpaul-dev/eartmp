# Handoff: EARTMP Desktop Shell (Academic Records & Transcript Management)

## ▶ How to run this handoff

1. Open this folder from the root of the **`Student_Record_Management`** repo.
2. In **Claude Code**, paste the entire contents of **`CLAUDE_CODE_TASK.md`** as
   your first message. That prompt drives the whole build in milestones.
3. This `README.md` is the **design spec** the task refers to — exact tokens,
   per-screen layout, and behavior. A developer who wasn't in the original
   conversation can implement the UI from this file alone.

## What's in this bundle

```
design_handoff_eartmp_shell/
├── CLAUDE_CODE_TASK.md     ← paste this into Claude Code to run the build
├── README.md               ← this file: the precise design spec
├── design/
│   ├── EARTMP.dc.html         ← hi-fi prototype (editable source)
│   └── EARTMP-standalone.html ← open in a browser to click through all screens
├── integration/            ← typed wiring package, reconciled to the real core
│   ├── INTEGRATION.md         ← screen → use-case → permission map (READ FIRST)
│   ├── README.md              ← file tour + drop-in steps
│   └── src/…                  ← contract, ipcClient, host dispatcher, React hooks, ref screen
└── brief/
    ├── frontend-brief.md
    └── frontend-design-system.md
```

## Overview

EARTMP is the registry's offline system of record: admit students, enter and
process results, generate **digitally-signed, tamper-evident transcripts**, check
graduation eligibility, and review an **append-only audit trail**. This bundle is
the **frontend shell** for a backend that is already complete (Tauri 2 + React 19

- TS, SQLite, hexagonal core, 271 tests). The design's job is to make the core's
  guarantees legible and safe to operate.

## About the design files

The files in `design/` are **design references created in HTML** — a hi-fi
prototype showing intended look and behavior, with **mocked data**. They are not
production code. The task is to **recreate these designs as real React components
inside the repo's `src/presentation/`**, using the repo's existing conventions and
binding to the finished core through the `integration/` package. Do not embed or
ship the HTML.

## Fidelity: **High-fidelity**

Final colors, IBM Plex typography, spacing, badges, and interactions are
specified. Recreate the UI faithfully using the codebase's stack. Where the repo
already has primitives (buttons, inputs, dialogs), prefer those and apply these
tokens.

---

## Design tokens

### Color

| Token               | Hex                                                   | Use                                             |
| ------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Navy 900 (sidebar)  | `#13233d`                                             | sidebar bg, avatars, toast bg, login panel base |
| Navy gradient       | `#11203a → #1b3257 → #24406b`                         | login left panel                                |
| Sidebar text        | `#9fb0c7`                                             | nav labels; active `#ffffff`                    |
| Sidebar muted       | `#5e739a` / `#7e93b3`                                 | section headers, captions                       |
| Active nav bg / bar | `rgba(95,150,235,.16)` / `#5f96eb`                    | selected nav item                               |
| Accent (primary)    | `#2f6bdc`                                             | primary buttons, focus ring, links, active      |
| Accent hover        | `#2659bd`                                             | primary button hover                            |
| Focus ring          | `rgba(47,107,220,.14–.16)`                            | 3px input focus halo                            |
| App canvas          | `#eceef2`                                             | app background behind cards                     |
| Surface             | `#ffffff`                                             | cards, header, table bg                         |
| Subtle surface      | `#f8f9fb` / `#f8fafd` / `#fbfcfd`                     | table headers, zebra, footers                   |
| Border              | `#e4e7ec` / `#e2e6ec`                                 | card & control borders                          |
| Hairline            | `#eef0f3` / `#f1f3f6` / `#f3f5f7`                     | inner dividers, row borders                     |
| Text strong         | `#19212e` / `#1c2430`                                 | headings, key values                            |
| Text body           | `#3a4658` / `#5d6b7e`                                 | body, labels                                    |
| Text muted          | `#7a8597` / `#9099a8`                                 | captions, placeholders                          |
| Success             | bg `#e7f5ec` · fg `#15803d` · dot `#1ca34f`           | Active, Approved, Met, Verified, Encrypted      |
| Info/blue           | bg `#e8eefb`/`#eef3fd` · fg `#1d4ed8`                 | Graduated, Locked, key sealed chip              |
| Warning             | bg `#fdf0e3`/`#fdf6ea` · fg `#b4781a` · dot `#d98a1a` | Draft, Suspended, pending, alerts               |
| Danger              | bg `#fdeceb`/`#fdecec` · fg `#bb2d2d` · dot `#d64545` | Withdrawn, errors, F grade                      |
| Neutral chip        | bg `#eef0f3` · fg `#475467`                           | Deferred, generic                               |

> Badges always use **color + label + icon** (and a dot where shown) — never color
> alone.

### Typography — IBM Plex

- **IBM Plex Sans** — all UI (weights 400/500/600/700).
- **IBM Plex Mono** — matric/reg numbers, IDs, all numeric/tabular values, hashes,
  transcript numbers, code fields. Use `font-variant-numeric: tabular-nums`.
- **IBM Plex Serif** — the A4 transcript document only (Georgia fallback).
- Scale (px): page title 15.5/600 · card title 14–14.5/600 · body 13–13.5 · label
  12–12.5/500 · caption 11–12 · stat numbers 24–38/600 · transcript hero 20–22.
- Headings `letter-spacing: -.01em`; uppercase table headers 10.5px/600
  `letter-spacing:.05em`.

### Spacing, radius, shadow

- Card padding 16–22px; screen padding 26×30px; control padding ~10–11×13px.
- Radius: cards `12px`, controls/buttons `8–9px`, pills/badges `999px`, modals `14px`.
- Card shadow `0 1px 2px rgba(16,24,40,.04)`; modal `0 24px 60px rgba(8,15,30,.32)`;
  toast `0 14px 40px rgba(8,15,30,.4)`; A4 doc `0 8px 40px rgba(15,23,38,.16)`.
- Content max-width ~1180px, centered; forms ~760px; A4 page 620px wide.
- Transitions ~.12s on bg/border/shadow; respect `prefers-reduced-motion`.

### Iconography

Thin line icons, `stroke-width` ~2, 1.9 in nav; sizes 13–18px. (The prototype uses
inline SVG paths; swap for the repo's icon set, matching weight.)

---

## Screens / views

All screens share the **shell**: 248px navy sidebar (logo, grouped nav with
section headers, count badges, lock icons on permission-gated items, offline
status footer) + 60px white topbar (page title/subtitle, centered search with
`Ctrl K` hint, signing-key chip, user identity, lock button). Content scrolls in a
`#eceef2` canvas.

1. **Login** — split layout: navy left panel (brand, "tamper-evident · digitally
   signed" pill, value prop, offline/version footer); white right panel with
   username/password, a "change the default password" warning, primary **Sign in**,
   "protected workstation" note.
2. **Unlock signing key (modal)** — passphrase field (mono), a red **"lost
   passphrase is unrecoverable"** caution, Cancel / Unlock key.
3. **Dashboard** — 4 stat cards (active students, results pending, transcripts in
   draft, last backup); **System trust & integrity** panel (audit chain _Verified_,
   signing key _Sealed/Unlocked_, encrypted backup) with Verify-chain / Manage-key
   actions; Quick actions grid (gated; disabled = Super Admin only); Recent activity
   feed.
4. **Students** — filter bar (search, department, level, status chip, clear) +
   **Admit** button; table (matric mono · name · programme · level · status badge ·
   chevron); pager showing "1–8 of 1,284". Row → profile.
5. **Admit student** — two-column form (matric*, reg, full name*, programme*, entry
   level*, entry session\*) with "duplicates rejected" hint; footer "recorded in the
   audit log" + Admit & enroll.
6. **Student profile** — identity header (avatar, name, status badge, matric/
   programme/level, Academic-summary + Transcript actions); Record details; Enrollment
   history timeline; **Status transition** card (only valid next states; terminal =
   locked note; audited); Academic standing card (CGPA, class chip, credits).
7. **Result entry** — context selectors (student, semester, course, assessment
   structure); **Score entry** card: CA (max 30) + Exam (max 70) mono inputs with a
   live **Final score + grade + grade point + credits** readout (computed by core);
   footer Add-course / **Process semester**; an info note that processing locks the
   semester.
8. **Process semester (confirm)** — states scores → grades/GPA/credits then **locks**;
   audited; Cancel / Process & lock.
9. **Academic summary** — student header with CGPA + class chip; per-semester table
   (attempted/earned/quality points/GPA) with a cumulative row; Generate-transcript CTA.
10. **Transcripts** — status filter tabs (All/Draft/Approved/Locked) + Generate;
    table (transcript no. mono · student · issued · status badge · signature "Valid").
11. **Transcript preview (A4)** — serif document at 620px: seal, university header,
    field grid, course table, cumulative summary, signature + QR. **DRAFT** shows a
    diagonal watermark and export is preview-only; toolbar has Verify (→ green
    "Authentic"), Approve, Export.
12. **Import results** — 3-step wizard: **Upload** (dropzone, file chip, dry-run
    toggle) → **Validate** (totals: rows/valid/errors + scannable error table: row,
    field, message) → **Commit** (all-or-nothing warning → success state "1,237 written").
13. **Graduation** — student selector; **Eligibility report** table (requirement,
    required, actual, met badge); green "Eligible" banner + **Clear for graduation**
    (re-checks, audited, → GRADUATED).
14. **Audit log** — integrity banner ("Verify chain"); filters (actor/entity/action/
    date); append-only table (time mono · actor · action colored · entity · hash mono);
    footer "append-only · no edit or delete".
15. **Configuration** — grade scale bands table (range/grade/point/pass, "no gaps ·
    valid"); assessment structure (weights sum to 100%); transcript number rule with
    live next-number preview.

> Per-screen exact copy, columns, and number formats are visible in the prototype —
> open `design/EARTMP-standalone.html` and click through. Treat it as the visual
> source of truth.

## Interactions & behavior

- **Navigation**: sidebar drives a single-window app; active item highlighted with
  the blue left-bar. Gated items are disabled with a reason tooltip.
- **Async everywhere**: every list/action implements **loading → (empty | error) →
  success**. Use the `useAsync` / `useAction` hooks in `integration/`.
- **Confirms** for audited/irreversible actions (process, unlock result, approve,
  graduate, restore) — dialog states the consequence; backup restore needs a typed
  confirmation.
- **Toasts** (bottom-right, navy) confirm success — e.g. "Audit chain verified",
  "Transcript approved", "Committed 1,237 results".
- **Verify** flips the transcript/audit badge to a green authentic/verified state
  (result comes from the core's Ed25519 / hash-chain check — never faked).
- **Forms** validate before submit and show **field-level** errors; duplicate matric
  surfaces as a conflict on the matric field.

## State management

Use the provided React runtime (`integration/src/presentation/runtime/react.tsx`):
`CoreProvider` holds the `SessionView`; `useCore()` exposes the typed `CoreApi`;
`useAsync`/`useAction` own per-call loading/error; `useSession().can(perm)` drives
fail-closed gating. Local UI state (filters, wizard step, selected ids, open
modals) stays in component state. **No global store needed** — reads re-fetch via
`reload()` after mutations. All data and permissions come from the core; the UI
stores none of the truth.

## Assets

No raster assets ship in the prototype — brand mark is the "NSU" monogram (replace
with the institution's real logo/seal), icons are inline line-SVG (swap for the
repo's icon set), and the transcript seal/QR are placeholders. Fonts: IBM Plex
Sans/Mono/Serif (Google Fonts; the repo should self-host or bundle for offline).

## Files

- `design/EARTMP.dc.html` — editable hi-fi prototype (all screens + interactions in
  one component).
- `design/EARTMP-standalone.html` — self-contained; open in any browser, offline.
- `integration/INTEGRATION.md` — the binding contract (read before coding).
- `integration/src/presentation/screens/StudentsScreen.tsx` — worked reference for
  the wiring pattern to copy across screens.

## Note on data & security

The core is authoritative for all computed values (final score, GPA/CGPA, grades,
signatures, eligibility) and for **authorization**. The UI displays and gates; it
must not recompute or re-decide. Keep `src/presentation/**` free of
`infrastructure`/DB/`invoke` imports (architecture test) — go through `useCore()`.
