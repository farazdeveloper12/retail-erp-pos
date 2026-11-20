"use client";

import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  function toggleTheme() {
    const root = document.documentElement;
    const isNowDark = root.classList.toggle("dark");
    try {
      localStorage.setItem("theme", isNowDark ? "dark" : "light");
    } catch {
      // Ignore if the browser does not allow saving
    }
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Switch between light and dark mode"
      title="Switch theme"
      className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-ink hover:bg-surface-muted"
    >
      <Moon className="h-5 w-5 dark:hidden" />
      <Sun className="hidden h-5 w-5 dark:block" />
    </button>
  );
}
