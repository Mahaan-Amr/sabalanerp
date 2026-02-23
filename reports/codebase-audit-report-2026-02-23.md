# Sabalan ERP Deep Audit Report (2026-02-23)

## 1) Project Structure & Architecture

### Repo topology

| Path | Role | Notes |
|---|---|---|
| `frontend/` | Next.js 14 App Router UI | Workspace dashboards, contracts, CAD/stone tools |
| `backend/` | Express + Prisma API | Auth, CRM, sales, inventory, security, PDF/confirmation |
| `deploy/` | Production edge/deploy | Nginx reverse-proxy + certbot scripts |
| `docker-compose.yml` | Local infra | Postgres + Redis profiles |
| `docker-compose.prod.yml` | Production stack | Postgres, backend, frontend, nginx, optional redis |

### Runtime architecture
- Browser -> Nginx:
  - `/` -> frontend
  - `/api/*` -> backend
  - `/socket.io/*` -> backend (websocket)
  - `/files/contracts/*` -> backend static storage
- Backend -> PostgreSQL via Prisma (`backend/prisma/schema.prisma`)
- Backend -> SMS provider via `backend/src/services/smsService.ts`
- Backend -> PDF generation with Chromium/Puppeteer via `backend/src/utils/pdf.ts`

### High-level style
- **Client-server monolith split** (single frontend app + single backend app), not microservices.
- Workspaces are logical modules, not separate deployable services.

## 2) Module & Component Analysis

### Frontend
- API transport: `frontend/src/lib/api.ts`
  - Single Axios client, token injector, broad endpoint surface.
- State/auth/workspace context:
  - `frontend/src/contexts/AuthContext.tsx`
  - `frontend/src/contexts/WorkspaceContext.tsx`
- Contract creation subsystem:
  - Large feature surface under `frontend/src/features/contract-creation/*`
  - Heavy modal/hook/service composition.
- CAD/Stone subsystem:
  - `frontend/src/components/StoneCanvas.tsx`
  - `frontend/src/components/stone-cad/*`

Patterns:
- Hook-heavy composition, page-local orchestration, utility-service split.

Deviations:
- Very large UI files reduce cohesion (`frontend/src/app/dashboard/sales/contracts/create/page.tsx` ~9.6k lines).
- Text sanitation utility existed but partial usage before this implementation (`frontend/src/lib/textSanitizer.ts`).

### Backend
- Entrypoint: `backend/src/index.ts`
- Route clusters (23 route modules, ~198 handlers):
  - Sales, inventory, CRM, security, contracts/templates/public confirmations.
- Service layer examples:
  - `backend/src/services/contractConfirmationService.ts`
  - `backend/src/services/paymentService.ts`
- PDF/print:
  - `backend/src/utils/printTemplate.ts`
  - `backend/src/utils/pdf.ts`

Patterns:
- Route-controller style with selective service extraction.

Deviations:
- Very large route modules:
  - `backend/src/routes/sales.ts`
  - `backend/src/routes/security.ts`
  - `backend/src/routes/inventory.ts`
  - `backend/src/routes/products.ts`
- Mixed legacy/new domain entities (`Customer` and `CrmCustomer`) increase semantic drift risk.

## 3) Code Quality & Maintainability

### Current quality signals
- Backend TS build: passes.
- Frontend production build: passes.
- Lint: many warnings; dominant classes:
  - `react-hooks/exhaustive-deps`
  - accessibility (`combobox` ARIA)
  - `@next/next/no-img-element`

### Hotspots
- `frontend/src/app/dashboard/sales/contracts/create/page.tsx` (~9.6k lines)
- `frontend/src/features/contract-creation/components/modals/ProductConfigurationModal.tsx` (~3.4k lines)
- `frontend/src/components/StoneCanvas.tsx` (~2.2k lines)
- `backend/src/routes/sales.ts` (~1.4k lines)
- `backend/src/routes/security.ts` (~1.4k lines)
- `backend/src/routes/inventory.ts` (~1.1k lines)
- `backend/src/routes/products.ts` (~1.1k lines)

### Refactor backlog (priority)
1. Split mega pages/routes into feature-focused modules.
2. Replace `any` payloads with typed DTO interfaces in API boundary files.
3. Centralize repeated Persian labels/statuses.
4. Reduce side-effect-heavy page components with service hooks.

## 4) Security & Vulnerability Assessment

### 4.1 Package vulnerability status after this implementation
- Frontend:
  - Upgraded `next` to `14.2.35`, `axios` to `^1.13.5`.
  - Remaining `npm audit --omit=dev`: 3 high (includes `next` advisories requiring major jump to 15/16, plus transitive `glob/minimatch`).
- Backend:
  - Upgraded `express` to `^4.22.1`, `express-validator` to `^7.3.1`, `axios` to `^1.13.5`.
  - Added `sanitize-html` for server-side HTML sanitization.
  - Remaining `npm audit --omit=dev`: 6 (4 high, 2 moderate), with unresolved direct risk on `xlsx`.

### 4.2 App-level security findings and changes
- Potential XSS sink paths use `dangerouslySetInnerHTML`:
  - `frontend/src/app/dashboard/contracts/[id]/page.tsx`
  - `frontend/src/app/dashboard/sales/contracts/[id]/page.tsx`
- Implemented mitigation:
  - Added server-side contract HTML sanitizer: `backend/src/utils/htmlSanitizer.ts`
  - Enforced sanitizer in template create/update and generated content:
    - `backend/src/routes/contractTemplates.ts`

### 4.3 Excel import hardening (implemented)
- `backend/src/routes/products.ts`:
  - Magic-byte validation for `.xlsx/.xls` payloads.
  - Suspicious upload quarantine to `uploads/quarantine`.
  - Import row cap guard (`MAX_IMPORT_ROWS = 5000`).
  - Existing file-size cap retained.

## 5) Performance & Scalability

### Identified bottlenecks
- Contract creation route bundle remains heavy (`/dashboard/sales/contracts/create`: ~196k route JS in current build).
- Complex render/calculation modules:
  - `StoneCanvas`
  - stair/contract calculation services.
- Backend monolithic routes likely increase latency variance under growth.

### Improvements backlog
- Route-level code splitting and lazy-loading modals/CAD.
- Memoization dependency correction in high-traffic pages.
- Data virtualization for long tables/lists.
- Extract and cache master-data lookups in backend.
- Add DB index review against top query predicates in sales/inventory routes.

## 6) Testing & Coverage

### Current state
- First-party automated tests detected: 1
  - `frontend/src/features/contract-creation/services/__tests__/partitionPositioningService.test.ts`

### Required additions
- Backend integration:
  - auth, permissions, sales lifecycle, public confirmation OTP, products import/export.
- Frontend:
  - dashboard/workspace rendering and contract critical flow.
- E2E:
  - login -> create contract -> send confirmation -> public confirm -> PDF.
- Encoding checks:
  - corruption signature gate integrated via scripts (see section 8).

## 7) External Dependencies & Integrations

### Critical integrations
- SMS confirmation flow: `backend/src/services/contractConfirmationService.ts`
- Nginx reverse proxy: `deploy/nginx/conf.d/app.conf.template`
- TLS renewal:
  - `deploy/scripts/issue-cert.sh`
  - `deploy/scripts/renew-cert.sh`

### Dependency strategy
- Patch-level upgrades applied now.
- Major upgrades (e.g., Next 15/16) should be a dedicated compatibility wave with regression suite.

## 8) Encoding Remediation (Main Objective)

### Implemented in this change set
- Added UTF-8 guardrails:
  - `.editorconfig`
  - `.gitattributes`
- Added corruption tooling:
  - `scripts/text-corruption-inventory.mjs`
  - `scripts/check-text-corruption.mjs`
  - Root scripts:
    - `npm run text:scan`
    - `npm run text:check`
- Produced machine inventory:
  - `reports/text-corruption-inventory.json`
  - `reports/text-corruption-inventory.csv`
- Repaired high-impact runtime text corruption in:
  - `frontend/src/app/dashboard/page.tsx`
  - `backend/src/services/contractConfirmationService.ts`
  - `backend/prisma/schema.prisma` defaults/comments
  - `backend/src/routes/products.ts` template/import/export labels/messages
- Introduced centralized contract status labels:
  - `frontend/src/lib/persianText.ts`

### Current measured inventory
- `npm run text:scan` now reports:
  - Total records: 2194
  - `mojibake`: 235
  - `replacement-char`: 68
  - `question-marks`: 1891

Interpretation:
- High-impact paths are repaired, but full codebase cleanup is still ongoing.
- Remaining `???` placeholders are largely irreversible and require context-driven Persian reconstruction.

## 9) Public API / Interface Changes

Non-breaking additions:
- Server-side HTML sanitization for contract template content.
- New internal tooling scripts and report outputs for corruption governance.

No external API path/signature breaking changes introduced.

## 10) Acceptance Check Snapshot

- Backend build: pass.
- Frontend build: pass.
- Security packages partially remediated:
  - Critical frontend advisory reduced from previous state; residual highs remain.
  - Backend high/moderate reduced but unresolved `xlsx` risk remains.
- Encoding:
  - Core user-facing files repaired.
  - Full repo still requires phased continuation using generated inventory.

## 11) Next Implementation Wave (prioritized)
1. Sweep remaining `mojibake` records from `reports/text-corruption-inventory.json`.
2. Resolve `???` placeholders in top 20 most-impacted files using contextual reconstruction.
3. Add HTML sanitization tests and basic API integration suite for confirmation/import routes.
4. Introduce CI gate for `npm run text:check` and vulnerability threshold.
5. Start decomposition of contract creation mega page into feature modules.
