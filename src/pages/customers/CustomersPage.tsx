import { useQuery } from "@tanstack/react-query";
import { Contact, Plus, Search } from "lucide-react";
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useOrg, useOrgId } from "@/app/org";
import { ExportMenu } from "@/components/common/ExportMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Card, EmptyState, Money, PageHeader } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { supabase, unwrap } from "@/lib/supabase";
import type { Customer } from "@/lib/types";
import { CustomerForm } from "./CustomerForm";

export default function CustomersPage() {
  const orgId = useOrgId();
  const { can } = useOrg();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [term, setTerm] = React.useState("");
  const [owing, setOwing] = React.useState(params.get("balance") === "1");
  const [creating, setCreating] = React.useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["customers", orgId],
    queryFn: async () => unwrap(await supabase.from("customers").select("*, customer_groups(name)").eq("organization_id", orgId).order("name").limit(5000)) as (Customer & { customer_groups: { name: string } | null })[],
  });
  const rows = (data ?? []).filter((c) => (!owing || Number(c.account_balance) > 0) &&
    (!term || `${c.name} ${c.phone ?? ""} ${c.email ?? ""}`.toLowerCase().includes(term.toLowerCase())));
  return (
    <>
      <PageHeader title="Customers" description="Customer records, credit accounts and store credit."
        actions={
          <>
            <ExportMenu rows={rows} filename="customers" title="Customers" columns={[
              { header: "Name", value: (c) => c.name }, { header: "Phone", value: (c) => c.phone }, { header: "Email", value: (c) => c.email }, { header: "TIN", value: (c) => c.tin },
              { header: "Group", value: (c) => c.customer_groups?.name }, { header: "Credit limit", value: (c) => c.credit_limit, numeric: true },
              { header: "Balance owed", value: (c) => c.account_balance, numeric: true }, { header: "Store credit", value: (c) => c.store_credit, numeric: true },
            ]} />
            {can("customers.manage") && <Button size="sm" onClick={() => setCreating(true)}><Plus /> New customer</Button>}
          </>
        } />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name, phone or email" className="ps-9" aria-label="Search customers" />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--lagoon)]" checked={owing} onChange={(e) => setOwing(e.target.checked)} /> Owing money</label>
        </div>
        <Table>
          <THead><tr><Th>Name</Th><Th>Phone</Th><Th>Group</Th><Th align="end">Credit limit</Th><Th align="end">Owes</Th><Th align="end">Store credit</Th></tr></THead>
          {isLoading ? <TableSkeleton cols={6} /> : (
            <tbody>
              {rows.map((c) => (
                <Tr key={c.id} onClick={() => navigate(`/customers/${c.id}`)}>
                  <Td className="font-medium">{c.name}{!c.is_active && <Badge className="ms-2">Inactive</Badge>}</Td>
                  <Td className="text-muted">{c.phone ?? "—"}</Td>
                  <Td className="text-muted">{c.customer_groups?.name ?? "—"}</Td>
                  <Td align="end" className="text-muted">{Number(c.credit_limit) ? <Money value={c.credit_limit} plain /> : "—"}</Td>
                  <Td align="end" className={Number(c.account_balance) > 0 ? "font-medium text-[#a5680d] dark:text-saffron" : "text-muted"}><Money value={c.account_balance} plain /></Td>
                  <Td align="end" className="text-muted"><Money value={c.store_credit} plain /></Td>
                </Tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6}><EmptyState icon={Contact} title={term || owing ? "No customers match" : "No customers yet"}>Customers can also be added from the register.</EmptyState></td></tr>}
            </tbody>
          )}
        </Table>
      </Card>
      <CustomerForm customer={null} open={creating} onOpenChange={setCreating} />
    </>
  );
}
