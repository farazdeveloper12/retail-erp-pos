"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LogOut, Menu, Store, X } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { signOut } from "@/app/(app)/actions";
import { bottomNavSlugs, navItems, type NavItem } from "@/lib/navigation";

// Shown when the business name is not available.
const FALLBACK_NAME = "Retail workspace";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function Brand({ name }: { name: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink shadow-sm">
        <Store className="h-5 w-5" />
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-bold text-ink">{name}</p>
        <p className="text-xs text-ink-muted">Business management</p>
      </div>
    </div>
  );
}

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={
              // Active: teal tint, teal text and a teal bar on the left
              "relative flex min-h-11 items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors " +
              (active
                ? "bg-accent-soft font-semibold text-pill-ink before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-accent"
                : "text-ink-muted hover:bg-surface-muted hover:text-ink")
            }
          >
            <item.icon className={"h-5 w-5 shrink-0 " + (active ? "text-accent" : "")} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function AppShell({
  children,
  userName,
  userRole,
  allowedSlugs,
  businessName,
}: {
  children: ReactNode;
  userName: string;
  userRole: string;
  allowedSlugs: string[];
  businessName?: string | null;
}) {
  const pathname = usePathname();
  const workspaceName = businessName?.trim() || FALLBACK_NAME;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Only the items this user is allowed to open
  const visibleItems = navItems.filter((item) =>
    allowedSlugs.includes(item.slug)
  );
  const bottomItems = visibleItems.filter((item) =>
    bottomNavSlugs.includes(item.slug)
  );

  return (
    <div className="min-h-screen bg-canvas print:min-h-0 print:bg-white">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface lg:flex print:hidden!">
        <div className="flex h-16 items-center border-b border-line px-5">
          <Brand name={workspaceName} />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <NavLinks items={visibleItems} pathname={pathname} />
        </div>
        <div className="m-3 rounded-xl border border-line bg-surface-muted px-4 py-3">
          <p className="truncate text-xs font-semibold text-ink">{workspaceName}</p>
          <p className="text-xs text-ink-muted">Signed in as {userRole}</p>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-line bg-surface shadow-soft">
            <div className="flex h-16 items-center justify-between gap-2 border-b border-line px-4">
              <Brand name={workspaceName} />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <NavLinks
                items={visibleItems}
                pathname={pathname}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
            <Link
              href="/settings/account"
              onClick={() => setDrawerOpen(false)}
              className="m-3 block rounded-xl border border-line bg-surface-muted px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            >
              <p className="text-sm font-semibold text-ink">{userName}</p>
              <p className="text-xs text-ink-muted">{userRole} · My account</p>
            </Link>
          </div>
        </div>
      )}

      {/* Right side: top bar + page content */}
      <div className="lg:pl-64 print:pl-0!">
        <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur print:hidden">
          <div className="flex h-16 items-center justify-between gap-3 px-3 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2 lg:hidden">
              <button
                type="button"
                aria-label="Open menu"
                onClick={() => setDrawerOpen(true)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-surface-muted"
              >
                <Menu className="h-5 w-5" />
              </button>
              <span className="truncate text-sm font-bold text-ink">
                {workspaceName}
              </span>
            </div>
            <p className="hidden pl-2 text-sm text-ink-muted lg:block">
              Welcome back,{" "}
              <span className="font-semibold text-ink">{userName}</span>
            </p>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/settings/account"
                title="My account"
                className="hidden items-center gap-2 rounded-full pr-2 hover:bg-surface-muted sm:flex"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-pill-ink">
                  {initials(userName)}
                </div>
                <div className="text-left leading-tight">
                  <p className="text-sm font-semibold text-ink">{userName}</p>
                  <p className="text-xs text-ink-muted">{userRole}</p>
                </div>
              </Link>
              <ThemeToggle />
              <form action={signOut}>
                <button
                  type="submit"
                  aria-label="Log out"
                  title="Log out"
                  className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-muted"
                >
                  <LogOut className="h-5 w-5" />
                  <span className="hidden sm:inline">Log out</span>
                </button>
              </form>
            </div>
          </div>
        </header>

        <main className="px-4 py-5 pb-28 sm:px-6 sm:py-6 lg:px-8 lg:pb-10 print:p-0!">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface/95 px-1 pt-1 backdrop-blur lg:hidden print:hidden!"
        style={{
          gridTemplateColumns: `repeat(${bottomItems.length + 1}, minmax(0, 1fr))`,
          paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))",
        }}
      >
        {bottomItems.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition-colors " +
                (active ? "font-semibold text-accent" : "text-ink-muted")
              }
            >
              <item.icon className="h-5 w-5" />
              <span>
                {item.slug === "" ? "Home" : item.label.split(" ")[0]}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium text-ink-muted"
        >
          <Menu className="h-5 w-5" />
          <span>Menu</span>
        </button>
      </nav>
    </div>
  );
}
