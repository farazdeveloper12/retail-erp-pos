import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Noto_Naskh_Arabic, Plus_Jakarta_Sans } from "next/font/google";
import { DEFAULT_WORKSPACE_NAME, getMyBusiness } from "@/lib/business";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

// Arabic text on bilingual invoices (prints Arabic letters correctly)
const naskhArabic = Noto_Naskh_Arabic({
  subsets: ["arabic"],
  weight: ["400", "700"],
  variable: "--font-naskh-arabic",
  display: "swap",
  preload: false,
});

// The tab title uses the business name. On the login page (no session)
// or on any error it falls back to a neutral name, so it never breaks a page.
export async function generateMetadata(): Promise<Metadata> {
  let name = DEFAULT_WORKSPACE_NAME;
  try {
    const business = await getMyBusiness();
    if (business?.name?.trim()) name = business.name.trim();
  } catch {
    // Keep the fallback name
  }

  return {
    title: {
      default: name,
      template: `%s | ${name}`,
    },
    description: "Retail management system",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f3ea" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1916" },
  ],
};

// Applies the saved theme before the page paints, so the screen does not flash.
// Light is the default unless the user has chosen dark.
const themeScript = `
(function () {
  try {
    if (localStorage.getItem("theme") === "dark") {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${naskhArabic.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-canvas font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
