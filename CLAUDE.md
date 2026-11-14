# Engineering conventions

## Project

Retail ERP and point-of-sale web app for a mobile phone and accessories shop, built to grow into a multi-business (SaaS) product.

- Stack: Next.js 16 (App Router, `src/` directory, Server Components and Server Actions), React 19, TypeScript, Tailwind CSS 4, Supabase (Postgres, Auth, Row Level Security), lucide-react.
- Database changes are written as SQL and reviewed before they are applied. Schema scripts will live under `supabase/`.

## Folder conventions

- `src/app/(app)/` – signed-in pages. Each feature has its own folder with `page.tsx`, a `actions.ts` for server actions and client components next to it.
- `src/app/login/` – sign-in page.
- `src/components/` – shared UI (`ui.tsx`), pickers, charts and other reusable components.
- `src/lib/` – Supabase clients (`supabase/server.ts`, `client.ts`, `admin.ts`), permissions, navigation, money and formatting helpers.
- `docs/` – documentation assets such as README screenshots.

## Security rules

- Never commit secrets or `.env` files. Only `.env.example` with placeholder values is tracked.
- `SUPABASE_SECRET_KEY` is server-only: it is used only in `src/lib/supabase/admin.ts`, which imports `server-only`. Never prefix it with `NEXT_PUBLIC_`.
- Use the normal server Supabase client for user requests so Row Level Security decides what a user may read or write.
- Every table has Row Level Security enabled; access rules use `has_permission()`.
- Stock and money writes go through database functions that check permissions and run in one transaction.
- Every server action checks the user's permissions again; never trust values sent from the browser (for example `business_id` or `created_by`).
- Costs and other financial data are only queried for users who have the matching permission.
- No hard deletes: deactivate (`is_active`) or void records instead.

## Data and money

- Money is stored as `numeric` and handled in the app as whole cents with `BigInt` (`src/lib/money.ts`); never use floating point for totals.
- Financial calculations that are saved belong in the database; the browser only shows previews.
- Dates are shown in Pakistan time (Asia/Karachi).
- New tables are designed so a `business_id` can scope them; phone-specific features (IMEI, storage, condition) stay separable from the core retail features.

## UI and code style

- All application text, error messages, code comments, identifiers and commit messages are professional English.
- Do not show placeholder or fake numbers; show a clear empty state when there is no data.
- Do not hard-code the business name in reusable components; it comes from business settings.
- Responsive for laptop, tablet and phone, with touch targets of at least 44 px.
- Use the shared design tokens in `src/app/globals.css` and components in `src/components/ui.tsx`; both light and dark themes must work.
- Do not add new dependencies without a clear need.
- Edit files as UTF-8 with normal editor tools.

## Workflow

- For now, work directly on `main`.
- After each finished task run `npx tsc --noEmit`, `npm run lint` and `npm run build`; all three must pass.
- Commit with a clear Conventional Commits message (`feat:`, `fix:`, `docs:`, `chore:`, ...).
- A local `post-commit` hook pushes every commit to `origin` automatically. If the push fails it only prints a warning; push later with `git push`.
- Never force-push. Never commit secrets or `.env` files.
- When production deployment starts, switch to a `dev` branch with pull requests into `main`.
