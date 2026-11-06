"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LogOut, Menu, Store, X } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { signOut } from "@/app/(app)/actions";
import { bottomNavSlugs, navItems, type NavItem } from "@/lib/navigation";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
        <Store className="h-5 w-5" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-bold tracking-wide">GWADAR TECH HUB</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Business Management
        </p>
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
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors " +
              (active
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
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
}: {
  children: ReactNode;
  userName: string;
  userRole: string;
  allowedSlugs: string[];
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Sirf wohi items jin ki ijazat hai
  const visibleItems = navItems.filter((item) =>
    allowedSlugs.includes(item.slug)
  );
  const bottomItems = visibleItems.filter((item) =>
    bottomNavSlugs.includes(item.slug)
  );

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks items={visibleItems} pathname={pathname} />
        </div>
        <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Phase 5: Roles
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-slate-800">
              <Brand />
              <button
                type="button"
                aria-label="Menu band karein"
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <NavLinks
                items={visibleItems}
                pathname={pathname}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Right side: top bar + page content */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 dark:border-slate-800 dark:bg-slate-900/90">
          <div className="flex items-center gap-3 lg:hidden">
            <button
              type="button"
              aria-label="Menu kholein"
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-bold tracking-wide">
              GWADAR TECH HUB
            </span>
          </div>
          <div className="hidden lg:block" />

          <div className="flex items-center gap-2">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-semibold">{userName}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {userRole}
              </p>
            </div>
            <ThemeToggle />
            <form action={signOut}>
              <button
                type="submit"
                aria-label="Logout"
                title="Logout"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <LogOut className="h-5 w-5" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </form>
          </div>
        </header>

        <main className="px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden dark:border-slate-800 dark:bg-slate-900"
        style={{
          gridTemplateColumns: `repeat(${bottomItems.length + 1}, minmax(0, 1fr))`,
        }}
      >
        {bottomItems.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                "flex flex-col items-center gap-1 py-2 text-[11px] font-medium " +
                (active
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-slate-500 dark:text-slate-400")
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
          className="flex flex-col items-center gap-1 py-2 text-[11px] font-medium text-slate-500 dark:text-slate-400"
        >
          <Menu className="h-5 w-5" />
          <span>Menu</span>
        </button>
      </nav>
    </div>
  );
}