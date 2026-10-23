import { describe, expect, it } from "vitest";
import { parseCsv, validateImport } from "./csv";
import { toCsv } from "./export";

describe("csv", () => {
  it("parses quotes, commas and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
  });

  it("validates rows and flags duplicates", () => {
    const { rows } = validateImport(
      "name,sku,barcode,retail_price,opening_stock\nTuna,T1,111,18.50,10\nRice,T1,111,abc,\n,X9,,5,\n",
      new Set(["x9"]), new Set(),
    );
    expect(rows[0].errors).toEqual([]);
    expect(rows[1].errors).toEqual(expect.arrayContaining(["Retail price must be a number like 12.50", "SKU repeats line 2", "Barcode repeats line 2"]));
    expect(rows[2].errors).toEqual(expect.arrayContaining(["Name is required", "SKU X9 already exists"]));
  });

  it("round-trips through the exporter and neutralises formulas", () => {
    const out = toCsv([{ n: "=HYPERLINK(1)", v: -5 }], [{ header: "n", value: (r) => r.n }, { header: "v", value: (r) => r.v }]);
    expect(out).toBe("n,v\n'=HYPERLINK(1),-5");
  });
});
