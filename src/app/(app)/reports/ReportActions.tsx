"use client";

import { Download, Printer } from "lucide-react";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui";

// Quotes a CSV cell when needed
function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Print and "Download CSV" for the daily sales table. The CSV is built in
// the browser, UTF-8 with a BOM so Excel opens it correctly.
export default function ReportActions({
  csvRows,
  fileName,
}: {
  csvRows: string[][];
  fileName: string;
}) {
  function downloadCsv() {
    const text = "﻿" + csvRows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <button type="button" onClick={() => window.print()} className={primaryButtonClass}>
        <Printer className="h-4 w-4" />
        Print
      </button>
      <button type="button" onClick={downloadCsv} className={secondaryButtonClass}>
        <Download className="h-4 w-4" />
        Download CSV
      </button>
    </div>
  );
}
