import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Receipt, Search } from "lucide-react";
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useOrg, useOrgId } from "@/app/org";
import { DateRangePicker, useRange } from "@/components/common/DateRange";
import { ExportMenu } from "@/components/common/ExportMenu";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, Card, EmptyState, Money, PageHeader } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { addDaysISO, fmtDateTime } from "@/lib/dates";
import { supabase, unwrap } from "@/lib/supabase";
import type { Sale } from "@/lib/types";

type Row = Sale & { customers: { name: string } | null; outlets: { name: string } };

export const paymentStatus: Record<Sale["payment_status"], { label: string; tone: "ok" | "saffron" | "lagoon" | "coral" }> = {
  paid: { label: "Paid", tone: "ok" },
  pending_verification: { label: "Transfer pending", tone: "saffron" },
  on_account: { label: "On account", tone: "lagoon" },
  payment_rejected: { label: "Payment rejected", tone: "coral" },
};

const PAGE = 100;

export default function SalesPage() {
  const orgId = useOrgId();
  const { outlets } = useOrg();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [range, setRange] = useRange(params.get("payment") ? "30d" : "7d");
  const [outlet, setOutlet] = React.useState("");
  const [payment, setPayment] = React.useState(params.get("payment") ?? "");
  const [term, setTerm] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDebounced(term.trim()), 250); return () => clearTimeout(t); }, [term]);

  const names = useQuery({ queryKey: ["member-names", orgId], queryFn: async () => unwrap(await supabase.rpc("member_names", { p_org: orgId })) as { user_id: string; display_name: string }[] });
  const cashier = (id: string) => names.data?.find((n) => n.user_id === id)?.display_name ?? "—";

  const q = useInfiniteQuery({
    queryKey: ["sales", orgId, range.from, range.to, outlet, payment, debounced],
    initialPageParam: 0,
    getNextPageParam: (last: Row[], all) => (last.length === PAGE ? all.length * PAGE : undefined),
    queryFn: async ({ pageParam }) => {
      let s = supabase.from("sales").select("*, customers(name), outlets(name)").eq("organization_id", orgId)
        .order("sold_at", { ascending: false }).range(pageParam, pageParam + PAGE - 1);
      if (debounced) s = s.ilike("invoice_number", `%${debounced.replace(/[%,]/g, "")}%`);
      else s = s.gte("sold_at", `${range.from}T00:00:00+05:00`).lt("sold_at", `${addDaysISO(range.to, 1)}T00:00:00+05:00`);
      if (outlet) s = s.eq("outlet_id", outlet);
      if (payment === "voided") s = s.eq("status", "voided");
      else if (payment) s = s.eq("payment_status", payment);
      return unwrap(await s) as unknown as Row[];
    },
  });
  const rows = q.data?.pages.flat() ?? [];
  const totals = rows.filter((r) => r.status === "completed").reduce((s, r) => s + Number(r.total), 0);

  return (
    <>
      <PageHeader title="Sales" description="Every completed and voided sale. Open one to reprint, refund or void."
        actions={<ExportMenu rows={rows} filename={`sales-${range.from}-${range.to}`} title="Sales" subtitle={`${range.from} to ${range.to}`} columns={[
          { header: "Invoice", value: (r) => r.invoice_number }, { header: "Date", value: (r) => fmtDateTime(r.sold_at) }, { header: "Outlet", value: (r) => r.outlets.name },
          { header: "Customer", value: (r) => r.customers?.name }, { header: "Cashier", value: (r) => cashier(r.cashier_id) }, { header: "Status", value: (r) => r.status },
          { header: "Payment", value: (r) => paymentStatus[r.payment_status].label }, { header: "Tax", value: (r) => r.tax_total, numeric: true },
          { header: "Discount", value: (r) => r.discount_total, numeric: true }, { header: "Total", value: (r) => r.total, numeric: true },
        ]} />} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative w-56">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Invoice number" className="h-8 ps-9" aria-label="Search invoice" />
          </div>
          {!debounced && <DateRangePicker value={range} onChange={setRange} />}
          {outlets.length > 1 && (
            <Select aria-label="Outlet" value={outlet} onChange={(e) => setOutlet(e.target.value)} className="h-8 w-40">
              <option value="">All outlets</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          )}
          <Select aria-label="Payment status" value={payment} onChange={(e) => setPayment(e.target.value)} className="h-8 w-44">
            <option value="">Any status</option>
            <option value="paid">Paid</option>
            <option value="pending_verification">Transfer pending</option>
            <option value="on_account">On account</option>
            <option value="payment_rejected">Payment rejected</option>
            <option value="voided">Voided</option>
          </Select>
          <span className="ms-auto text-sm text-muted">{rows.length} sales · <Money value={totals} className="font-semibold text-fg" /></span>
        </div>
        <Table>
          <THead><tr><Th>Invoice</Th><Th>Date</Th><Th>Customer</Th><Th>Cashier</Th><Th>Status</Th><Th align="end">Total (MVR)</Th></tr></THead>
          {q.isLoading ? <TableSkeleton cols={6} /> : (
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id} onClick={() => navigate(`/sales/${r.id}`)}>
                  <Td className="font-medium">{r.invoice_number}{r.is_offline && <Badge className="ms-2">Offline</Badge>}</Td>
                  <Td className="whitespace-nowrap text-muted">{fmtDateTime(r.sold_at)}</Td>
                  <Td>{r.customers?.name ?? <span className="text-muted">Walk-in</span>}</Td>
                  <Td className="text-muted">{cashier(r.cashier_id)}</Td>
                  <Td>{r.status === "voided" ? <Badge tone="coral">Voided</Badge> : <Badge tone={paymentStatus[r.payment_status].tone}>{paymentStatus[r.payment_status].label}</Badge>}</Td>
                  <Td align="end" className={r.status === "voided" ? "text-muted line-through" : "font-medium"}><Money value={r.total} plain /></Td>
                </Tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6}><EmptyState icon={Receipt} title="No sales found">Change the dates or filters.</EmptyState></td></tr>}
            </tbody>
          )}
        </Table>
        {q.hasNextPage && <div className="border-t border-line p-3 text-center"><Button variant="secondary" size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load more</Button></div>}
      </Card>
    </>
  );
}
