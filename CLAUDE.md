# Project rules

## About this project
- Retail ERP and POS web app. First customer: a mobile phone and accessories shop (GWADAR TECH HUB). Future goal: sell it as SaaS to other kinds of retail businesses.
- Stack: Next.js 16 (App Router, src/ directory), React 19, TypeScript, Tailwind CSS 4, Supabase (Postgres, Auth, RLS), lucide-react.
- Already built and tested: login/logout, route protection (src/proxy.ts), users and roles, per-user permissions, product catalog (brands, models, variants, colors).
- Key places: src/app/(app) (pages with sidebar), src/app/login, src/components, src/lib/supabase (server, client, admin), src/lib/permissions.ts, src/lib/navigation.ts.

## Communication with the user
- The user is a complete beginner. Reply in simple Roman Urdu. Keep technical terms in English and explain them.
- For every change tell the user: what changed, why, which files, how to run it, how to test it.
- Work in small steps. After a batch of work, run the checks once and report. Do not ask for checks after every tiny change.

## Language of the application (strict)
- Everything inside the app must be professional English: UI text, buttons, labels, placeholders, errors, emails, PDFs, seed data, database messages, code comments, variable and function names.
- Zero Roman Urdu anywhere in the app or its code. Never translate the user's Roman Urdu instructions into Roman Urdu UI text.

## Protect the existing project
- Never recreate the project, never replace it with a template, never remove working features.
- Never delete or rename files, folders, components, functions, routes or database fields unless clearly needed and approved first.
- Do not change form field names, server actions, or RPC names/signatures without checking every place they are used.
- Do not add new dependencies unless truly necessary. Ask first.
- Work only on the git branch named redesign. The tag pre-redesign marks the last safe state. Do not commit, push, merge or switch branches unless the user asks.
- Never read, print, edit or commit .env.local or any secret. SUPABASE_SECRET_KEY must stay server-side only (src/lib/supabase/admin.ts).

## Database rules
- The database is on Supabase and managed by the user through the SQL Editor. Never reset it, never drop tables, never delete records.
- Database changes are written as SQL text for the user to review and run. They must be additive and backward compatible.
- Every table must have RLS enabled. Use has_permission() for access rules. Money uses numeric, never floats. Financial calculations belong in the database or server, not in the browser.
- Prefer soft delete (is_active) over deleting rows.

## UI rules
- Do not show fake numbers. Where data does not exist yet, show a clean empty state.
- Do not hardcode the business name in reusable components. It will come from business settings later.
- Responsive: laptop, tablet and Android phone. Touch-friendly controls on mobile.
- Do not use copyrighted product photos. Use original illustrations or the shop's own uploaded photos.

## Design direction
- Warm ivory background, white cards, soft shadows, rounded corners. Teal as the main accent, with coral, amber and purple as secondary accents. Active menu item as a lime pill.
- Pastel KPI cards (peach, lavender, aqua, mint). Product grid with photo tiles and stock status pills. POS layout with category chips, product grid and a cart panel.
- Light theme by default. Avoid heavy dark blue and avoid a generic AI-dashboard look.

## Checks
- After a batch: npx tsc --noEmit, npm run lint, npm run build. Report results honestly. Never claim something works unless it was actually tested.

## Future SaaS readiness
- New tables should be designed so a business_id can be added later. Keep the mobile-phone features (IMEI, serial, PTA, storage/RAM) separable from the core retail features.
