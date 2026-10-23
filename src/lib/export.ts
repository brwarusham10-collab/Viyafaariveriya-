// CSV / XLSX / PDF exports for tables. Values are exported as shown, with money as numbers.
export interface Column<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  numeric?: boolean;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // neutralise spreadsheet formula injection
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [columns.map((c) => esc(c.header)).join(","), ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(","))].join("\n");
}

export function exportCsv<T>(rows: T[], columns: Column<T>[], filename: string) {
  download(new Blob(["﻿" + toCsv(rows, columns)], { type: "text/csv;charset=utf-8" }), `${filename}.csv`);
}

export async function exportXlsx<T>(rows: T[], columns: Column<T>[], filename: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const header = columns.map((c) => ({ value: c.header, fontWeight: "bold" as const }));
  const data = rows.map((r) =>
    columns.map((c) => {
      const v = c.value(r);
      if (c.numeric && v !== null && v !== undefined && v !== "") return { type: Number, value: Number(v) };
      return { type: String, value: v === null || v === undefined ? "" : String(v) };
    }),
  );
  await writeXlsxFile([header, ...data] as never).toFile(`${filename}.xlsx`);
}

export async function exportPdf<T>(rows: T[], columns: Column<T>[], filename: string, title: string, subtitle?: string) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ orientation: columns.length > 6 ? "landscape" : "portrait", unit: "pt" });
  doc.setFont("helvetica", "bold").setFontSize(14).text(title, 40, 40);
  if (subtitle) doc.setFont("helvetica", "normal").setFontSize(9).text(subtitle, 40, 56);
  autoTable(doc, {
    startY: 70,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => {
      const v = c.value(r);
      return c.numeric && v !== null && v !== undefined && v !== "" ? Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 }) : String(v ?? "");
    })),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [13, 43, 51] },
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, { halign: c.numeric ? "right" : "left" }])),
  });
  doc.save(`${filename}.pdf`);
}
