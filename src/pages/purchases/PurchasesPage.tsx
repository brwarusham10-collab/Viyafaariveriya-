import { useQuery } from "@tanstack/react-query";
import { ClipboardList, PackageCheck, Plus } from "lucide-react";
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useOrg, useOrgId } from "@/app/org";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Badge, Card, EmptyState, Money, PageHeader } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { supabase, unwrap } from "@/lib/supabase";
import { ReceiveDialog } from "./ReceiveDialog";

export const poTone = { draft: "neutral", approved: "lagoon", partial: "saffron", received: "ok", cancelled: "coral" } as const;
export const poLabel = { draft: "Draft", approved: "Approved", partial: "Partly received", received: "Received", cancelled: "Cancelled" };

export default function PurchasesPage() {
  const orgId = useOrgId();
  const { can } = useOrg();
  const navigate = useNavigate();
  const [status, setStatus] = React.useState("");
  const [tab, setTab] = React.useState<"orders" | "receipts">("orders");
  const [receiveOpen, setReceiveOpen] = React.useState(false);
  const orders = useQuery({
    queryKey: ["purchase-orders", orgId, status],
    queryFn: async () => {
      let q = supabase.from("purchase_orders").select("id, po_number, status, order_date, expected_date, total, suppliers(name), warehouses(name)").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(300);
      if (status) q = q.eq("status", status);
      return unwrap(await q) as unknown as { id: string; po_number: string; status: keyof typeof poLabel; order_date: string; expected_date: string | null; total: number; suppliers: { name: string }; warehouses: { name: string } }[];
    },
  });
  const receipts = useQuery({
    queryKey: ["goods-receipts", orgId],
    enabled: tab === "receipts",
    queryFn: async () => unwrap(await supabase.from("goods_receipts").select("id, grn_number, received_at, items_total, landed_total, supplier_invoice_ref, purchase_order_id, suppliers(name), warehouses(name), purchase_orders(po_number)").eq("organization_id", orgId).order("received_at", { ascending: false }).limit(300)) as unknown as { id: string; grn_number: string; received_at: string; items_total: number; landed_total: number; supplier_invoice_ref: string | null; suppliers: { name: string }; warehouses: { name: string }; purchase_orders: { po_number: string } | null }[],
  });
  return (
    <>
      <PageHeader title="Purchases" description="Order from suppliers, receive stock, and capture freight and duty into product cost."
        actions={can("purchases.manage") && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setReceiveOpen(true)}><PackageCheck /> Receive without PO</Button>
            <Button size="sm" asChild><Link to="/purchases/new"><Plus /> New purchase order</Link></Button>
          </>
        )} />
      <div className="mb-3 flex items-center gap-2">
        <div className="flex rounded-md border border-line-strong p-0.5">
          {(["orders", "receipts"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1 text-sm ${tab === t ? "bg-reef text-white" : "text-muted"}`}>{t === "orders" ? "Purchase orders" : "Goods received"}</button>)}
        </div>
        {tab === "orders" && <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-44">
          <option value="">All statuses</option>{Object.entries(poLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>}
      </div>
      <Card>
        {tab === "orders" ? (
          <Table>
            <THead><tr><Th>PO</Th><Th>Supplier</Th><Th>Deliver to</Th><Th>Ordered</Th><Th>Expected</Th><Th>Status</Th><Th align="end">Total (MVR)</Th></tr></THead>
            {orders.isLoading ? <TableSkeleton cols={7} /> : (
              <tbody>
                {orders.data?.map((o) => (
                  <Tr key={o.id} onClick={() => navigate(`/purchases/${o.id}`)}>
                    <Td className="font-medium">{o.po_number}</Td><Td>{o.suppliers.name}</Td><Td className="text-muted">{o.warehouses.name}</Td>
                    <Td className="text-muted">{fmtDate(o.order_date)}</Td><Td className="text-muted">{o.expected_date ? fmtDate(o.expected_date) : "—"}</Td>
                    <Td><Badge tone={poTone[o.status]}>{poLabel[o.status]}</Badge></Td><Td align="end"><Money value={o.total} plain /></Td>
                  </Tr>
                ))}
                {orders.data?.length === 0 && <tr><td colSpan={7}><EmptyState icon={ClipboardList} title="No purchase orders">Create one, or start from low-stock suggestions on a new order.</EmptyState></td></tr>}
              </tbody>
            )}
          </Table>
        ) : (
          <Table>
            <THead><tr><Th>GRN</Th><Th>Supplier</Th><Th>PO</Th><Th>Invoice ref</Th><Th>Received</Th><Th align="end">Items</Th><Th align="end">Landed total</Th></tr></THead>
            {receipts.isLoading ? <TableSkeleton cols={7} /> : (
              <tbody>
                {receipts.data?.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-medium">{r.grn_number}</Td><Td>{r.suppliers.name}</Td><Td className="text-muted">{r.purchase_orders?.po_number ?? "—"}</Td>
                    <Td className="text-muted">{r.supplier_invoice_ref ?? "—"}</Td><Td className="text-muted">{fmtDateTime(r.received_at)}</Td>
                    <Td align="end"><Money value={r.items_total} plain /></Td><Td align="end" className="font-medium"><Money value={r.landed_total} plain /></Td>
                  </Tr>
                ))}
                {receipts.data?.length === 0 && <tr><td colSpan={7}><EmptyState icon={PackageCheck} title="Nothing received yet" /></td></tr>}
              </tbody>
            )}
          </Table>
        )}
      </Card>
      <ReceiveDialog open={receiveOpen} onOpenChange={setReceiveOpen} po={null} />
    </>
  );
}
