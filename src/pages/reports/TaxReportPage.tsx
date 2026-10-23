import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import * as React from "react";
import { useOrg, useOrgId } from "@/app/org";
import { DateRangePicker, useRange } from "@/components/common/DateRange";
import { ExportMenu } from "@/components/common/ExportMenu";
import { Select } from "@/components/ui/input";
import { Card, CardHeader, ErrorNotice, Money, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { fmtDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { rpc } from "@/lib/supabase";

interface TaxRow { rate: number; sales_taxable: number; sales_tax: number; documents: number; refund_taxable: number; refund_tax: number; net_taxable: number; net_tax: number }
interface TaxSummary { organization: { name: string; legal_name: string | null; tin: string | null; gst_registration: string | null }; prices_include_tax: boolean; rates: TaxRow[]; net_taxable: number; net_tax: number }

export default function TaxReportPage() {
  const orgId = useOrgId();
  const { outlets } = useOrg();
  const [range, setRange] = useRange("mtd");
  const [outlet, setOutlet] = React.useState("");
  const q = useQuery({ queryKey: ["tax-summary", orgId, range.from, range.to, outlet], queryFn: () => rpc<TaxSummary>("report_tax_summary", { p_org: orgId, p_from: range.from, p_to: range.to, p_outlet: outlet || null }) });
  const rows = q.data?.rates ?? [];
  const period = `${fmtDate(range.from)} – ${fmtDate(range.to)}`;
  const org = q.data?.organization;
  return (
    <>
      <PageHeader title="GST summary" description={period} actions={
        <>
          {outlets.length > 1 && <Select aria-label="Outlet" value={outlet} onChange={(e) => setOutlet(e.target.value)} className="h-8 w-40"><option value="">All outlets</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}
          <DateRangePicker value={range} onChange={setRange} />
          <ExportMenu rows={rows} filename={`gst-summary-${range.from}-${range.to}`} title={`GST summary — ${org?.legal_name || org?.name || ""}`}
            subtitle={`${period} · TIN ${org?.tin ?? "not set"} · GST reg. ${org?.gst_registration ?? "not set"}`} columns={[
              { header: "Rate %", value: (r) => r.rate, numeric: true }, { header: "Invoices", value: (r) => r.documents, numeric: true },
              { header: "Taxable sales", value: (r) => r.sales_taxable, numeric: true }, { header: "Output tax", value: (r) => r.sales_tax, numeric: true },
              { header: "Refunds taxable", value: (r) => r.refund_taxable, numeric: true }, { header: "Refund tax", value: (r) => r.refund_tax, numeric: true },
              { header: "Net taxable", value: (r) => r.net_taxable, numeric: true }, { header: "Net output tax", value: (r) => r.net_tax, numeric: true }]} />
        </>
      } />
      <div className="mb-4 flex gap-3 rounded-lg border border-saffron/40 bg-saffron-soft px-4 py-3 text-sm text-[#7a4f0f] dark:text-saffron">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          A summary of output tax from your sales, to help you prepare a return. It is not a MIRA filing format and hasn't been verified against
          MIRA's current return requirements. Input tax on purchases, exempt supplies and adjustments aren't included — check the figures with your accountant before filing.
        </p>
      </div>
      {q.error && <ErrorNotice error={q.error} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Net taxable value" value={formatMoney(q.data?.net_taxable)} loading={q.isLoading} />
        <Stat label="Net output tax" value={formatMoney(q.data?.net_tax)} loading={q.isLoading} />
        <Stat label="TIN" value={org?.tin ?? "Not set"} loading={q.isLoading} />
        <Stat label="GST registration" value={org?.gst_registration ?? "Not set"} loading={q.isLoading} />
      </div>
      <Card className="mt-4">
        <CardHeader title="By tax rate" description={q.data?.prices_include_tax ? "Prices include tax; tax is extracted from each line." : "Tax was added on top of prices."} />
        <Table>
          <THead><tr><Th align="end">Rate</Th><Th align="end">Invoices</Th><Th align="end">Taxable sales</Th><Th align="end">Output tax</Th><Th align="end">Refunds (taxable)</Th><Th align="end">Refund tax</Th><Th align="end">Net taxable</Th><Th align="end">Net tax</Th></tr></THead>
          {q.isLoading ? <TableSkeleton cols={8} rows={3} /> : (
            <tbody>
              {rows.map((r) => (
                <Tr key={r.rate}>
                  <Td align="end" className="font-medium">{Number(r.rate)}%</Td><Td align="end">{r.documents}</Td><Td align="end"><Money value={r.sales_taxable} plain /></Td><Td align="end"><Money value={r.sales_tax} plain /></Td>
                  <Td align="end" className="text-muted"><Money value={-r.refund_taxable} plain /></Td><Td align="end" className="text-muted"><Money value={-r.refund_tax} plain /></Td>
                  <Td align="end" className="font-medium"><Money value={r.net_taxable} plain /></Td><Td align="end" className="font-medium"><Money value={r.net_tax} plain /></Td>
                </Tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-muted">No taxable sales in this period.</td></tr>}
            </tbody>
          )}
        </Table>
      </Card>
    </>
  );
}
