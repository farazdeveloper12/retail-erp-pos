"use client";

import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  function toggleTheme() {
    const root = document.documentElement;
    const isNowDark = root.classList.toggle("dark");
    try {
      localStorage.setItem("theme", isNowDark ? "dark" : "light");
    } catch {
      // Agar browser save na karne de to koi masla nahi
    }
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Light ya Dark mode badlein"
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      <Moon className="h-5 w-5 dark:hidden" />
      <Sun className="hidden h-5 w-5 dark:block" />
    </button>
  );
}