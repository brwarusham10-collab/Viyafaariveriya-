/** RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF/LF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface ImportRow {
  line: number;
  name: string;
  variant: string;
  sku: string;
  barcode: string;
  category: string;
  retail_price: string;
  cost_price: string;
  wholesale_price: string;
  opening_stock: string;
  min_stock: string;
  errors: string[];
}

export const IMPORT_COLUMNS = ["name", "variant", "sku", "barcode", "category", "retail_price", "cost_price", "wholesale_price", "opening_stock", "min_stock"] as const;

const money = /^\d+(\.\d{1,2})?$/;
const qty = /^-?\d+(\.\d{1,3})?$/;

/** Validate rows against the template and against SKUs/barcodes that already exist. */
export function validateImport(text: string, existingSkus: Set<string>, existingBarcodes: Set<string>): { rows: ImportRow[]; headerError?: string } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], headerError: "The file is empty." };
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const idx = (c: string) => header.indexOf(c);
  if (idx("name") < 0 || idx("retail_price") < 0) return { rows: [], headerError: "The first row must include at least name and retail_price columns." };
  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  const rows = table.slice(1).map((r, i) => {
    const get = (c: string) => (idx(c) >= 0 ? (r[idx(c)] ?? "").trim() : "");
    const row: ImportRow = {
      line: i + 2,
      name: get("name"), variant: get("variant"), sku: get("sku"), barcode: get("barcode"), category: get("category"),
      retail_price: get("retail_price"), cost_price: get("cost_price"), wholesale_price: get("wholesale_price"),
      opening_stock: get("opening_stock"), min_stock: get("min_stock"), errors: [],
    };
    if (!row.name) row.errors.push("Name is required");
    if (!money.test(row.retail_price)) row.errors.push("Retail price must be a number like 12.50");
    if (row.cost_price && !money.test(row.cost_price)) row.errors.push("Cost price must be a number");
    if (row.wholesale_price && !money.test(row.wholesale_price)) row.errors.push("Wholesale price must be a number");
    if (row.opening_stock && !qty.test(row.opening_stock)) row.errors.push("Opening stock must be a number");
    if (row.min_stock && !qty.test(row.min_stock)) row.errors.push("Minimum stock must be a number");
    if (row.sku) {
      const k = row.sku.toLowerCase();
      if (existingSkus.has(k)) row.errors.push(`SKU ${row.sku} already exists`);
      if (seenSku.has(k)) row.errors.push(`SKU repeats line ${seenSku.get(k)}`);
      seenSku.set(k, row.line);
    }
    if (row.barcode) {
      if (existingBarcodes.has(row.barcode)) row.errors.push(`Barcode ${row.barcode} already exists`);
      if (seenBarcode.has(row.barcode)) row.errors.push(`Barcode repeats line ${seenBarcode.get(row.barcode)}`);
      seenBarcode.set(row.barcode, row.line);
    }
    return row;
  });
  return { rows };
}
