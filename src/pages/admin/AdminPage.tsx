import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { Select } from "@/components/ui/input";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { rpc } from "@/lib/supabase";

interface Overview {
  totals: { organizations: number; active: number; suspended: number; users: number; sales_30d: number; gmv_30d: number };
  organizations: { id: string; name: string; status: string; plan: string; created_at: string; members: number; outlets: number; sales_30d: number; last_sale_at: string | null }[];
}

/** Platform operators only (platform_admins table). Shows tenant metadata and aggregates — never tenant transactions. */
export default function AdminPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-overview"], queryFn: () => rpc<Overview>("admin_overview"), retry: false });
  if (q.error) return <><PageHeader title="Platform admin" /><EmptyState icon={Shield} title="Platform admins only">{String((q.error as Error).message)}</EmptyState></>;
  const t = q.data?.totals;
  const set = async (id: string, status: string | null, plan: string | null) => {
    try { await rpc("admin_set_organization", { p_org: id, p_status: status, p_plan: plan }); qc.invalidateQueries({ queryKey: ["admin-overview"] }); toast.success("Updated"); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <>
      <PageHeader title="Platform admin" description="Tenants, subscriptions and platform-wide activity. Every change here is audit-logged." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Businesses" value={t?.organizations ?? 0} loading={q.isLoading} hint={t && `${t.suspended} suspended`} />
        <Stat label="Active" value={t?.active ?? 0} loading={q.isLoading} />
        <Stat label="Users" value={t?.users ?? 0} loading={q.isLoading} />
        <Stat label="Sales, 30 days" value={t?.sales_30d ?? 0} loading={q.isLoading} />
        <Stat label="Volume, 30 days" value={formatMoney(t?.gmv_30d)} loading={q.isLoading} />
      </div>
      <Card className="mt-4">
        <Table>
          <THead><tr><Th>Business</Th><Th>Created</Th><Th align="end">Users</Th><Th align="end">Outlets</Th><Th align="end">Sales 30d</Th><Th>Last sale</Th><Th>Plan</Th><Th>Status</Th></tr></THead>
          {q.isLoading ? <TableSkeleton cols={8} /> : (
            <tbody>
              {q.data?.organizations.map((o) => (
                <Tr key={o.id}>
                  <Td className="font-medium">{o.name}</Td><Td className="text-muted">{fmtDate(o.created_at)}</Td><Td align="end">{o.members}</Td><Td align="end">{o.outlets}</Td>
                  <Td align="end">{o.sales_30d}</Td><Td className="text-muted">{o.last_sale_at ? fmtDateTime(o.last_sale_at) : "—"}</Td>
                  <Td><Select aria-label="Plan" value={o.plan} onChange={(e) => set(o.id, null, e.target.value)} className="h-8 w-32">
                    {["trial", "starter", "growth", "enterprise"].map((p) => <option key={p} value={p}>{p}</option>)}</Select></Td>
                  <Td><div className="flex items-center gap-2"><Badge tone={o.status === "active" ? "ok" : o.status === "suspended" ? "saffron" : "coral"} className="capitalize">{o.status}</Badge>
                    <Select aria-label="Status" value={o.status} onChange={(e) => set(o.id, e.target.value, null)} className="h-8 w-32">
                      <option value="active">Active</option><option value="suspended">Suspend</option><option value="closed">Close</option></Select></div></Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
      </Card>
      <p className="mt-3 text-xs text-muted">Volume is the sum of completed sale totals.</p>
    </>
  );
}
