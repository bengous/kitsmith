---
paths:
  - "apps/frontend/**"
---

## Frontend Workspace Conventions

- Runtime: Bun workspace under `apps/frontend`.
- Framework: React with TanStack Router, Vite, Vitest, and Playwright.
- Keep frontend code independent from backend starter code in root `src/` unless an explicit API or RPC contract is introduced.
- Use `createFileRoute`/`createRootRoute` from `@tanstack/react-router` for route files.
- Treat `src/routeTree.gen.ts` as generated TanStack Router output. Do not edit it manually.
- Keep route files thin: route declaration, search/param validation, loader wiring, and composition. Move reusable UI and behavior into colocated components or hooks.
- Use TanStack Router navigation primitives (`Link`, `useNavigate`, typed params/search) for in-app navigation. Use full-page navigation only for external URLs or intentional app reloads.
- Prefer typed search params and route params over ad hoc string parsing.
- Keep server data out of local component state or global UI stores. When API-backed server state is added, introduce a deliberate query layer with stable keys, targeted invalidation after mutations, and tests.
- Keep component state local unless multiple components need coordinated access.
- Add route/component tests with Testing Library and Vitest for behavior changes; use Playwright for user-facing flows that cross routing or browser boundaries.
- Keep CSS scoped and simple. Prefer existing `styles.css` conventions before adding new styling tools.
