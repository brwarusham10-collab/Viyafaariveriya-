import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, ScanBarcode } from "lucide-react";
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { downloadReceiptPdf } from "@/components/receipt/Receipt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import { Badge, Card, EmptyState, Money, PageHeader } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { formatQty } from "@/lib/money";
import { rpc, supabase, unwrap } from "@/lib/supabase";
import type { CatalogItem } from "@/lib/types";
import { uuid } from "@/lib/utils";
import { customerPrice, useCart, type CartLine } from "../pos/cartStore";
import { customerSelect, toCartCustomer } from "../pos/CustomerPicker";

interface Quote {
  id: string;
  quote_number: string;
  status: "draft" | "sent" | "accepted" | "converted" | "expired" | "cancelled";
  valid_until: string | null;
  total: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  notes: string | null;
  created_at: string;
  outlet_id: string;
  customer_id: string | null;
  cart_discount: { type: "percent" | "fixed"; value: string } | null;
  customers: { name: string; phone: string | null; tin: string | null; address: string | null } | null;
  quotation_items: { variant_id: string; name: string; qty: number; unit_price: number; discount_type: "percent" | "fixed" | null; discount_value: number; tax_rate: number; tax_amount: number; line_total: number; line_no: number }[];
}

const tone = { draft: "neutral", sent: "lagoon", accepted: "ok", converted: "reef", expired: "saffron", cancelled: "coral" } as const;

export default function QuotationsPage() {
  const orgId = useOrgId();
  const { org, outlet, can } = useOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = React.useState("open");
  const { data, isLoading } = useQuery({
    queryKey: ["quotations", orgId, status],
    queryFn: async () => {
      let q = supabase.from("quotations").select("*, customers(name, phone, tin, address), quotation_items(*)").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(300);
      if (status === "open") q = q.in("status", ["draft", "sent", "accepted"]);
      else if (status) q = q.eq("status", status);
      return unwrap(await q) as unknown as Quote[];
    },
  });
  const selected = data?.find((q) => q.id === params.get("id")) ?? null;

  async function loadIntoRegister(q: Quote) {
    const cart = useCart.getState();
    if (cart.lines.length) return toast.error("Finish or park the sale in progress first.");
    const snap = await rpc<{ items: CatalogItem[] }>("pos_catalog", { p_org: orgId, p_outlet: q.outlet_id });
    const byId = new Map(snap.items.map((i) => [i.variant_id, i]));
    const customer = q.customer_id
      ? toCartCustomer(unwrap(await supabase.from("customers").select(customerSelect).eq("id", q.customer_id).single()) as never) : null;
    const missing: string[] = [];
    const lines: CartLine[] = [];
    for (const it of [...q.quotation_items].sort((a, b) => a.line_no - b.line_no)) {
      const cat = byId.get(it.variant_id);
      if (!cat) { missing.push(it.name); continue; }
      const list = customerPrice(cat.price, cat.wholesale_price, customer);
      lines.push({
        key: uuid(), variantId: cat.variant_id, productId: cat.product_id, name: it.name, sku: cat.sku, qty: String(Number(it.qty)),
        listPrice: list, unitPrice: Number(it.unit_price).toFixed(2), basePrice: cat.price, wholesalePrice: cat.wholesale_price,
        taxRate: String(cat.tax_rate), trackStock: cat.track_stock, allowDecimal: cat.allow_decimal || cat.sold_by_weight, stock: cat.stock,
        discountType: it.discount_type, discountValue: it.discount_type ? String(Number(it.discount_value)) : "",
      });
    }
    cart.load({ lines, cartDiscount: q.cart_discount, customer, quotationId: q.id, notes: q.notes ?? "" });
    if (missing.length) toast.warning(`Not available any more: ${missing.join(", ")}`);
    navigate("/pos");
  }

  return (
    <>
      <PageHeader title="Quotations" description="Price quotes for customers. Load one into the register to turn it into a sale."
        actions={<Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-40">
          <option value="open">Open</option><option value="converted">Converted</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option><option value="">All</option>
        </Select>} />
      <Card>
        <Table>
          <THead><tr><Th>Number</Th><Th>Customer</Th><Th>Created</Th><Th>Valid until</Th><Th>Status</Th><Th align="end">Total (MVR)</Th></tr></THead>
          {isLoading ? <TableSkeleton cols={6} /> : (
            <tbody>
              {data?.map((q) => (
                <Tr key={q.id} onClick={() => setParams({ id: q.id })}>
                  <Td className="font-medium">{q.quote_number}</Td>
                  <Td>{q.customers?.name ?? <span className="text-muted">—</span>}</Td>
                  <Td className="text-muted">{fmtDateTime(q.created_at)}</Td>
                  <Td className="text-muted">{q.valid_until ? fmtDate(q.valid_until) : "—"}</Td>
                  <Td><Badge tone={tone[q.status]} className="capitalize">{q.status}</Badge></Td>
                  <Td align="end"><Money value={q.total} plain /></Td>
                </Tr>
              ))}
              {data?.length === 0 && <tr><td colSpan={6}><EmptyState icon={FileText} title="No quotations">Build a sale in the register and choose “Save as quotation”.</EmptyState></td></tr>}
            </tbody>
          )}
        </Table>
      </Card>
      <Dialog open={!!selected} onOpenChange={(o) => !o && setParams({})}>
        {selected && (
          <DialogContent side="right" title={selected.quote_number} description={selected.customers?.name ?? "No customer"}>
            <Badge tone={tone[selected.status]} className="capitalize">{selected.status}</Badge>
            <ul className="mt-4 divide-y divide-line rounded-md border border-line text-sm">
              {selected.quotation_items.map((i) => (
                <li key={i.line_no} className="flex justify-between gap-3 px-3 py-2">
                  <span>{i.name} <span className="text-muted">× {formatQty(i.qty)}</span></span>
                  <Money value={i.line_total} plain />
                </li>
              ))}
              <li className="flex justify-between px-3 py-2 font-semibold"><span>Total</span><Money value={selected.total} /></li>
            </ul>
            <div className="mt-5 flex flex-wrap gap-2">
              {["draft", "sent", "accepted"].includes(selected.status) && can("pos.sell") && outlet?.id === selected.outlet_id && (
                <Button onClick={() => loadIntoRegister(selected)}><ScanBarcode /> Load into register</Button>
              )}
              <Button variant="secondary" onClick={() => downloadReceiptPdf({
                title: "QUOTATION", org: org!, outlet, register: null, cashier: null, customer: selected.customers,
                sale: { invoice_number: selected.quote_number, sold_at: selected.created_at, subtotal: selected.subtotal, discount_total: selected.discount_total,
                  tax_total: selected.tax_total, total: selected.total, change_given: 0, prices_include_tax: org!.prices_include_tax, status: "completed",
                  payment_status: "paid", balance_due: 0, notes: selected.valid_until ? `Valid until ${fmtDate(selected.valid_until)}` : selected.notes },
                items: selected.quotation_items.map((i) => ({ name: i.name, sku: null, qty: i.qty, unit_price: i.unit_price, line_discount: 0, cart_discount_alloc: 0, tax_rate: i.tax_rate, tax_amount: i.tax_amount, line_total: i.line_total })),
                payments: [],
              }, "a4")}><Download /> PDF</Button>
              {["draft", "sent", "accepted"].includes(selected.status) && (["sent", "accepted", "cancelled"] as const).filter((s) => s !== selected.status).map((s) => (
                <Button key={s} variant={s === "cancelled" ? "danger-ghost" : "ghost"} onClick={async () => {
                  try { await rpc("set_quotation_status", { p_quotation: selected.id, p_status: s }); qc.invalidateQueries({ queryKey: ["quotations"] }); }
                  catch (e) { toast.error((e as Error).message); }
                }}>Mark {s}</Button>
              ))}
            </div>
            {outlet?.id !== selected.outlet_id && <p className="mt-3 text-xs text-muted">Switch to the quotation's outlet to load it into a register.</p>}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
