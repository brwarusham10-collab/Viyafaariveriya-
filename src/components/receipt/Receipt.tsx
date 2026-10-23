import { Download, Mail, Printer } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/dates";
import { formatAmount, formatQty } from "@/lib/money";
import type { ReceiptData } from "@/lib/receipt";
import { cn } from "@/lib/utils";

export type ReceiptFormat = "58mm" | "80mm" | "a4";

function taxBreakdown(d: ReceiptData) {
  const by = new Map<string, { rate: number; taxable: number; tax: number }>();
  for (const i of d.items) {
    const rate = Number(i.tax_rate);
    const row = by.get(String(rate)) ?? { rate, taxable: 0, tax: 0 };
    row.tax += Number(i.tax_amount);
    row.taxable += Number(i.line_total) - (d.sale.prices_include_tax ? Number(i.tax_amount) : 0);
    by.set(String(rate), row);
  }
  return [...by.values()].sort((a, b) => b.rate - a.rate);
}

const statusNote: Record<string, string> = {
  pending_verification: "Bank transfer pending verification",
  on_account: "Charged to customer account",
  payment_rejected: "Payment rejected — balance outstanding",
};

/** Printable receipt. Thermal widths use a monospace-free compact layout; A4 is a tax invoice. */
export function ReceiptDocument({ data, format }: { data: ReceiptData; format: ReceiptFormat }) {
  const cur = data.org.currency || "MVR";
  const thermal = format !== "a4";
  const taxes = taxBreakdown(data);
  return (
    <div
      className={cn("print-area mx-auto bg-white text-[#111]", thermal ? "px-2 py-3 text-[11px] leading-[1.35]" : "p-10 text-[12.5px]")}
      style={{ width: format === "58mm" ? "58mm" : format === "80mm" ? "80mm" : "210mm", fontFamily: "var(--font-sans)" }}>
      {data.provisional && (
        <div className="mb-2 border border-dashed border-black px-2 py-1 text-center font-semibold">
          PROVISIONAL — offline sale. The invoice number is issued when this sale syncs.
        </div>
      )}
      {data.sale.status === "voided" && <div className="mb-2 text-center text-[14px] font-bold">VOID</div>}
      <div className={cn(thermal ? "text-center" : "flex items-start justify-between")}>
        <div>
          <div className={cn("font-bold", thermal ? "text-[14px]" : "text-[20px]")}>{data.org.legal_name || data.org.name}</div>
          {data.outlet && <div>{[data.outlet.name, data.outlet.address, data.outlet.island].filter(Boolean).join(", ")}</div>}
          {(data.outlet?.phone || data.org.phone) && <div>Tel {data.outlet?.phone || data.org.phone}</div>}
          {data.org.tin && <div>TIN {data.org.tin}</div>}
          {data.org.gst_registration && <div>GST reg. {data.org.gst_registration}</div>}
          {data.org.receipt_header && <div className="mt-1 whitespace-pre-line">{data.org.receipt_header}</div>}
        </div>
        {!thermal && (
          <div className="text-end">
            <div className="text-[18px] font-bold">{data.title ?? "TAX INVOICE"}</div>
            <div>No. {data.sale.invoice_number}</div>
            <div>{fmtDateTime(data.sale.sold_at)}</div>
          </div>
        )}
      </div>
      {thermal && (
        <div className="mt-2 border-y border-dashed border-black py-1">
          <div className="flex justify-between">
            <span>Inv {data.sale.invoice_number}</span>
            <span>{fmtDateTime(data.sale.sold_at)}</span>
          </div>
          <div className="flex justify-between">
            <span>{data.register?.name}</span>
            <span>{data.cashier}</span>
          </div>
        </div>
      )}
      {data.customer && (
        <div className={cn(thermal ? "mt-1" : "mt-6 rounded border border-[#ccc] p-3")}>
          <div className={cn(!thermal && "text-[11px] uppercase text-[#666]")}>{thermal ? "Customer: " : "Bill to"}</div>
          <div className="font-semibold">{data.customer.name}</div>
          {!thermal && data.customer.address && <div>{data.customer.address}</div>}
          {data.customer.phone && <div>{data.customer.phone}</div>}
          {data.customer.tin && <div>TIN {data.customer.tin}</div>}
        </div>
      )}

      {thermal ? (
        <div className="mt-2 space-y-1">
          {data.items.map((i, k) => (
            <div key={k}>
              <div>{i.name}</div>
              <div className="flex justify-between">
                <span>
                  {formatQty(i.qty)} × {formatAmount(i.unit_price)}
                  {Number(i.line_discount) + Number(i.cart_discount_alloc) > 0 && ` (−${formatAmount(Number(i.line_discount) + Number(i.cart_discount_alloc))})`}
                </span>
                <span className="tabular">{formatAmount(i.line_total)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <table className="mt-6 w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-black text-start">
              <th className="py-1.5 text-start">Item</th>
              <th className="py-1.5 text-end">Qty</th>
              <th className="py-1.5 text-end">Unit price</th>
              <th className="py-1.5 text-end">Discount</th>
              <th className="py-1.5 text-end">Tax %</th>
              <th className="py-1.5 text-end">Amount ({cur})</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i, k) => (
              <tr key={k} className="border-b border-[#ddd]">
                <td className="py-1.5">
                  {i.name}
                  {i.sku && <span className="ms-2 text-[11px] text-[#666]">{i.sku}</span>}
                </td>
                <td className="py-1.5 text-end tabular">{formatQty(i.qty)}</td>
                <td className="py-1.5 text-end tabular">{formatAmount(i.unit_price)}</td>
                <td className="py-1.5 text-end tabular">{formatAmount(Number(i.line_discount) + Number(i.cart_discount_alloc))}</td>
                <td className="py-1.5 text-end tabular">{Number(i.tax_rate)}</td>
                <td className="py-1.5 text-end tabular">{formatAmount(i.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={cn("mt-2", thermal ? "border-t border-dashed border-black pt-1" : "ms-auto mt-4 w-72")}>
        <Row label="Subtotal" value={data.sale.subtotal} />
        {Number(data.sale.discount_total) > 0 && <Row label="Discounts" value={-Number(data.sale.discount_total)} />}
        {!data.sale.prices_include_tax && <Row label="Tax" value={data.sale.tax_total} />}
        <div className={cn("flex justify-between font-bold", thermal ? "text-[14px]" : "border-t-2 border-black pt-1 text-[16px]")}>
          <span>Total {cur}</span>
          <span className="tabular">{formatAmount(data.sale.total)}</span>
        </div>
        {data.sale.prices_include_tax && <Row label="Includes tax" value={data.sale.tax_total} muted />}
        <div className="mt-1">
          {data.payments.map((p, k) => (
            <Row key={k} label={`${p.method_name}${p.reference ? ` (${p.reference})` : ""}${p.status === "pending" ? " · pending" : ""}`} value={p.tendered ?? p.amount} />
          ))}
          {Number(data.sale.change_given) > 0 && <Row label="Change" value={data.sale.change_given} />}
        </div>
        {statusNote[data.sale.payment_status] && <div className="mt-1 font-semibold">{statusNote[data.sale.payment_status]}</div>}
      </div>

      {taxes.some((t) => t.tax > 0) && (
        <div className={cn("mt-2", thermal ? "border-t border-dashed border-black pt-1" : "mt-6 w-80")}>
          <div className="font-semibold">Tax summary</div>
          {taxes.map((t) => (
            <div key={t.rate} className="flex justify-between tabular">
              <span>
                {t.rate}% on {formatAmount(t.taxable)}
              </span>
              <span>{formatAmount(t.tax)}</span>
            </div>
          ))}
        </div>
      )}
      {data.sale.notes && <div className="mt-2 whitespace-pre-line">{data.sale.notes}</div>}
      <div className={cn("mt-3 text-center", thermal ? "border-t border-dashed border-black pt-2" : "mt-10 text-[#555]")}>
        {data.org.receipt_footer || "Thank you for shopping with us."}
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: unknown; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-2", muted && "text-[#555]")}>
      <span>{label}</span>
      <span className="tabular">{formatAmount(value as number)}</span>
    </div>
  );
}

export async function downloadReceiptPdf(data: ReceiptData, format: ReceiptFormat) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const cur = data.org.currency || "MVR";
  if (format === "a4") {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFont("helvetica", "bold").setFontSize(16).text(data.org.legal_name || data.org.name, 40, 50);
    doc.setFont("helvetica", "normal").setFontSize(9);
    const head = [data.outlet?.name, data.outlet?.address, data.outlet?.island, data.org.tin ? `TIN ${data.org.tin}` : null,
      data.org.gst_registration ? `GST reg. ${data.org.gst_registration}` : null].filter(Boolean) as string[];
    head.forEach((l, i) => doc.text(l, 40, 66 + i * 12));
    doc.setFont("helvetica", "bold").setFontSize(14).text(data.provisional ? "PROVISIONAL RECEIPT" : data.title ?? "TAX INVOICE", 555, 50, { align: "right" });
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.text(`No. ${data.sale.invoice_number}`, 555, 66, { align: "right" });
    doc.text(fmtDateTime(data.sale.sold_at), 555, 78, { align: "right" });
    if (data.customer) doc.text(`Bill to: ${data.customer.name}${data.customer.tin ? ` (TIN ${data.customer.tin})` : ""}`, 40, 140);
    autoTable(doc, {
      startY: 155,
      head: [["Item", "Qty", "Unit price", "Discount", "Tax %", `Amount (${cur})`]],
      body: data.items.map((i) => [i.name, formatQty(i.qty), formatAmount(i.unit_price),
        formatAmount(Number(i.line_discount) + Number(i.cart_discount_alloc)), String(Number(i.tax_rate)), formatAmount(i.line_total)]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [13, 43, 51] },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    });
    let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
    const line = (l: string, v: unknown, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal").text(l, 380, y).text(formatAmount(v as number), 555, y, { align: "right" });
      y += 14;
    };
    line("Subtotal", data.sale.subtotal);
    if (Number(data.sale.discount_total) > 0) line("Discounts", -Number(data.sale.discount_total));
    if (!data.sale.prices_include_tax) line("Tax", data.sale.tax_total);
    line(`Total ${cur}`, data.sale.total, true);
    if (data.sale.prices_include_tax) line("Includes tax", data.sale.tax_total);
    for (const t of taxBreakdown(data)) line(`Tax ${t.rate}% on ${formatAmount(t.taxable)}`, t.tax);
    doc.setFontSize(9).text(data.org.receipt_footer || "Thank you for shopping with us.", 40, y + 20);
    doc.save(`${data.sale.invoice_number}.pdf`);
    return;
  }
  // Thermal-width PDF
  const width = format === "58mm" ? 164 : 227; // points
  const doc = new jsPDF({ unit: "pt", format: [width, 300 + data.items.length * 28 + data.payments.length * 12] });
  let y = 20;
  const center = (t: string, size = 8, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size).text(t, width / 2, y, { align: "center", maxWidth: width - 16 });
    y += size + 4;
  };
  const lr = (l: string, r: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(bold ? 9 : 7.5).text(l, 8, y, { maxWidth: width - 70 }).text(r, width - 8, y, { align: "right" });
    y += bold ? 13 : 11;
  };
  if (data.provisional) center("PROVISIONAL - OFFLINE SALE", 8, true);
  center(data.org.legal_name || data.org.name, 10, true);
  if (data.outlet) center(data.outlet.name);
  if (data.org.tin) center(`TIN ${data.org.tin}`);
  lr(`Inv ${data.sale.invoice_number}`, fmtDateTime(data.sale.sold_at));
  for (const i of data.items) {
    doc.setFontSize(7.5).text(i.name, 8, y, { maxWidth: width - 16 });
    y += 10;
    lr(`  ${formatQty(i.qty)} x ${formatAmount(i.unit_price)}`, formatAmount(i.line_total));
  }
  y += 4;
  lr(`Total ${cur}`, formatAmount(data.sale.total), true);
  lr(data.sale.prices_include_tax ? "Includes tax" : "Tax", formatAmount(data.sale.tax_total));
  for (const p of data.payments) lr(p.method_name, formatAmount((p.tendered ?? p.amount) as number));
  if (Number(data.sale.change_given) > 0) lr("Change", formatAmount(data.sale.change_given));
  y += 6;
  center(data.org.receipt_footer || "Thank you for shopping with us.", 7);
  doc.save(`${data.sale.invoice_number}-${format}.pdf`);
}

export function receiptMailto(data: ReceiptData, to = "") {
  const cur = data.org.currency || "MVR";
  const body = [
    `${data.org.name} — ${data.provisional ? "provisional receipt" : `invoice ${data.sale.invoice_number}`}`,
    fmtDateTime(data.sale.sold_at),
    "",
    ...data.items.map((i) => `${i.name}  ${formatQty(i.qty)} x ${formatAmount(i.unit_price)} = ${formatAmount(i.line_total)}`),
    "",
    `Total ${cur} ${formatAmount(data.sale.total)} (tax ${formatAmount(data.sale.tax_total)})`,
    "",
    data.org.receipt_footer || "Thank you for shopping with us.",
  ].join("\n");
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(`Receipt ${data.sale.invoice_number} from ${data.org.name}`)}&body=${encodeURIComponent(body)}`;
}

/** Format switcher + print/PDF/email actions around a receipt. */
export function ReceiptActions({ data, format, onFormat }: { data: ReceiptData; format: ReceiptFormat; onFormat: (f: ReceiptFormat) => void }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-md border border-line-strong p-0.5" role="radiogroup" aria-label="Receipt size">
        {(["58mm", "80mm", "a4"] as const).map((f) => (
          <button key={f} role="radio" aria-checked={format === f} onClick={() => onFormat(f)}
            className={cn("rounded px-2.5 py-1 text-xs font-medium", format === f ? "bg-reef text-white" : "text-muted hover:text-fg")}>
            {f === "a4" ? "A4" : f}
          </button>
        ))}
      </div>
      <Button variant="secondary" size="sm" onClick={() => window.print()}>
        <Printer /> Print
      </Button>
      <Button variant="secondary" size="sm" loading={busy} onClick={async () => {
        setBusy(true);
        try { await downloadReceiptPdf(data, format); } finally { setBusy(false); }
      }}>
        <Download /> PDF
      </Button>
      <Button variant="secondary" size="sm" asChild>
        <a href={receiptMailto(data)}>
          <Mail /> Email
        </a>
      </Button>
    </div>
  );
}
