// CSV helpers for downloads that open correctly in Excel.

export type CsvRow = Record<string, unknown>;

export function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Columns default to every key that appears in the rows
export function toCsv(rows: CsvRow[], columns?: string[]) {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))];
  // BOM so Excel opens UTF-8 correctly
  return "﻿" + lines.join("\r\n");
}
