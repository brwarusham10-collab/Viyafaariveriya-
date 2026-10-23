import { useQuery } from "@tanstack/react-query";
import { MonitorSmartphone, Vault } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useOrg, useOrgId } from "@/app/org";
import { DateRangePicker, useRange } from "@/components/common/DateRange";
import { ExportMenu } from "@/components/common/ExportMenu";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Badge, Card, CardHeader, EmptyState, Money, PageHeader } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/dates";
import { rpc, supabase, unwrap } from "@/lib/supabase";
import { useSession } from "@/stores/session";

interface Closeout {
  shift_id: string; outlet: string; register: string; opened_by: string; opened_at: string; closed_at: string | null; status: string;
  opening_float: number; expected_cash: number | null; counted_cash: number | null; variance: number | null; sales_count: number; sales_total: number;
}

export const shiftTone = { open: "lagoon", closed: "saffron", approved: "ok" } as const;

export default function ShiftsPage() {
  const orgId = useOrgId();
  const { registers, outlets, can } = useOrg();
  const navigate = useNavigate();
  const setRegister = useSession((s) => s.setRegister);
  const setOutlet = useSession((s) => s.setOutlet);
  const [params] = useSearchParams();
  const [range, setRange] = useRange("7d");
  const [status, setStatus] = React.useState(params.get("status") ?? "");

  const open = useQuery({ queryKey: ["open-shifts", orgId], queryFn: async () => unwrap(await supabase.from("shifts").select("id, register_id, opened_at, opening_float").eq("organization_id", orgId).eq("status", "open")) as { id: string; register_id: string; opened_at: string }[] });
  const history = useQuery({
    queryKey: ["shift-closeouts", orgId, range.from, range.to],
    enabled: can("reports.view") || can("shifts.approve") || can("shifts.manage"),
    queryFn: () => rpc<Closeout[]>("report_shift_closeouts", { p_org: orgId, p_from: range.from, p_to: range.to, p_outlet: null }),
  });
  const visibleOutlets = new Set(outlets.map((o) => o.id));
  const regs = registers.filter((r) => r.is_active && visibleOutlets.has(r.outlet_id));
  const rows = (history.data ?? []).filter((r) => !status || r.status === status);

  return (
    <>
      <PageHeader title="Registers & shifts" description="Open a shift with a counted float, record cash in and out, and close with a denomination count." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {regs.map((r) => {
          const s = open.data?.find((x) => x.register_id === r.id);
          return (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-display font-semibold">{r.name}</div>
                  <div className="text-xs text-muted">{outlets.find((o) => o.id === r.outlet_id)?.name}</div>
                </div>
                <Badge tone={s ? "lagoon" : "neutral"}>{s ? "Open" : "Closed"}</Badge>
              </div>
              <div className="mt-3 text-xs text-muted">{s ? `Since ${fmtDateTime(s.opened_at)}` : "No open shift"}</div>
              <div className="mt-3 flex gap-2">
                {s ? <Button size="sm" variant="secondary" asChild><Link to={`/shifts/${s.id}`}>Cash & close</Link></Button> : null}
                {can("pos.sell") && <Button size="sm" variant={s ? "ghost" : "primary"} onClick={() => { setOutlet(r.outlet_id); setRegister(r.id); navigate("/pos"); }}>
                  {s ? "Go to register" : "Open register"}</Button>}
              </div>
            </Card>
          );
        })}
        {regs.length === 0 && <Card className="sm:col-span-2 xl:col-span-4"><EmptyState icon={MonitorSmartphone} title="No registers">Add registers under Outlets.</EmptyState></Card>}
      </div>
      <Card className="mt-6">
        <CardHeader title="Shift history" action={
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-40">
              <option value="">All shifts</option><option value="open">Open</option><option value="closed">Closed, to review</option><option value="approved">Approved</option>
            </Select>
            <DateRangePicker value={range} onChange={setRange} />
            <ExportMenu rows={rows} filename="shift-closeouts" title="Shift closeouts" subtitle={`${range.from} to ${range.to}`} columns={[
              { header: "Register", value: (r) => `${r.outlet} / ${r.register}` }, { header: "Opened by", value: (r) => r.opened_by }, { header: "Opened", value: (r) => fmtDateTime(r.opened_at) },
              { header: "Closed", value: (r) => fmtDateTime(r.closed_at) }, { header: "Status", value: (r) => r.status }, { header: "Sales", value: (r) => r.sales_total, numeric: true },
              { header: "Expected cash", value: (r) => r.expected_cash, numeric: true }, { header: "Counted", value: (r) => r.counted_cash, numeric: true }, { header: "Variance", value: (r) => r.variance, numeric: true }]} />
          </div>} />
        <Table>
          <THead><tr><Th>Register</Th><Th>Cashier</Th><Th>Opened</Th><Th>Closed</Th><Th>Status</Th><Th align="end">Sales</Th><Th align="end">Expected cash</Th><Th align="end">Variance</Th></tr></THead>
          {history.isLoading ? <TableSkeleton cols={8} /> : (
            <tbody>
              {rows.map((r) => (
                <Tr key={r.shift_id} onClick={() => navigate(`/shifts/${r.shift_id}`)}>
                  <Td className="font-medium">{r.register}<div className="text-xs text-muted">{r.outlet}</div></Td>
                  <Td>{r.opened_by}</Td>
                  <Td className="whitespace-nowrap text-muted">{fmtDateTime(r.opened_at)}</Td>
                  <Td className="whitespace-nowrap text-muted">{r.closed_at ? fmtDateTime(r.closed_at) : "—"}</Td>
                  <Td><Badge tone={shiftTone[r.status as keyof typeof shiftTone]} className="capitalize">{r.status === "closed" ? "To review" : r.status}</Badge></Td>
                  <Td align="end">{r.sales_count} · <Money value={r.sales_total} plain /></Td>
                  <Td align="end">{r.expected_cash === null ? "—" : <Money value={r.expected_cash} plain />}</Td>
                  <Td align="end" className={Number(r.variance) < 0 ? "text-coral" : Number(r.variance) > 0 ? "text-[#a5680d] dark:text-saffron" : ""}>{r.variance === null ? "—" : <Money value={r.variance} plain />}</Td>
                </Tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8}><EmptyState icon={Vault} title="No shifts in this period" /></td></tr>}
            </tbody>
          )}
        </Table>
      </Card>
    </>
  );
}
