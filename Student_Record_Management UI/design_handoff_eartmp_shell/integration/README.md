# EARTMP — Frontend integration package

Turns the **design prototype** (`../EARTMP.dc.html`) into the real **`src/presentation/`**
layer of the Tauri 2 + React 19 + TypeScript app, wired to the **finished headless core**.

> The core is complete (all phases, 271 tests). What's missing is the desktop **shell**
> (UI + Tauri-SQL runtime). The prototype is the _look & behavior_ spec; these files are
> the _data layer_ that connects real screens to the core's use-cases.

**Start with [`INTEGRATION.md`](./INTEGRATION.md)** — the contract and the full
screen → use-case → permission map. This README is the file tour.

## Architecture: host / webview split (faithful to the repo)

The repo enforces an architecture boundary (`tests/architecture.test.ts`): the **webview
must not import** `src/infrastructure/**` or the DI container. So this package splits in two:

```
  React UI ──> CoreApi (ipcClient) ──► one Tauri command ──► HOST dispatcher
   (webview, pure)                                            (trusted)
                                                                 │ authorize(useCase, input, session)  ← the gate
                                                                 ▼
                                                      DI container → use-case → repo → SQLite
```

- **Webview side** (`src/presentation/**`) is pure: types, the `CoreApi` client, React hooks.
  It never sees `invoke`, infra, or `authorize`.
- **Host side** (`src/host/dispatcher.ts`) is trusted: owns the `SessionContext`, resolves
  use-cases from the container, and runs them through the core's real **fail-closed
  `authorize()`** gate. Identity comes from the session, never the caller (core F-16).

## File tour

| File                                          | Side    | Purpose                                                                                                                             |
| --------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `src/presentation/runtime/contract.ts`        | webview | `SessionView`, `CoreApi` (typed methods), `USE_CASE` (verb → real use-case `.name`). Imports real input/output types from the core. |
| `src/presentation/runtime/errors.ts`          | both    | `CoreError` + IPC envelope + `toErrorEnvelope` (maps the core's error classes).                                                     |
| `src/presentation/runtime/ipcClient.ts`       | webview | `createIpcClient(bridge)` → `CoreApi`. Forwards each method over one Tauri command, unwraps `{ ok, data                             | error }`. |
| `src/presentation/runtime/react.tsx`          | webview | `CoreProvider`, `useCore`, `useSession`/`can`, `useLogin`/`useLogout`, `useAsync`, `useAction`, `PermissionGate`.                   |
| `src/presentation/screens/StudentsScreen.tsx` | webview | Reference screen — copy its shape for every other screen.                                                                           |
| `src/presentation/main.example.tsx`           | webview | Composition root: build the IPC client, hydrate session, mount React.                                                               |
| `src/host/dispatcher.ts`                      | host    | `createDispatcher({ container, session })` → `dispatch(method, input)`. Wire ONE Tauri command to it.                               |

## Drop-in steps

1. Copy `src/presentation/**` and `src/host/dispatcher.ts` into the repo at those paths.
   (Relative imports assume that layout; switch to your tsconfig path alias if you use one.)
2. Register the use-cases in the DI container keyed by their class `.name`
   (`ListStudents`, `AdmitStudent`, …) so the dispatcher can resolve them.
3. Add ONE Tauri command `execute_use_case({ method, input })` → `dispatch(...)`,
   returning its envelope unchanged.
4. Build the React shell from the prototype, binding each screen via `useCore()` + `useAsync`/
   `useAction` (see `StudentsScreen.tsx`).

## Reconcile before coding (details in INTEGRATION.md §6)

These names were read from the core, but verify as you wire:

- `USE_CASE` strings vs the actual class `.name`s (e.g. confirm `unlockSigningKey` →
  `ChangeKeyPassphrase` vs a dedicated unseal op).
- `toErrorEnvelope` mappings vs `src/domain/errors/**`.
- DI container token convention (`.name` vs your own provider keys).
- `ProcessSemester` and config read outputs (typed `unknown` here pending exact return types).

These are reference `.ts`/`.tsx` files for the app repo (React 19 + TS, `@tauri-apps/api`,
`react-dom`); they're not compiled in this design project — type-check them in the app
once copied.
