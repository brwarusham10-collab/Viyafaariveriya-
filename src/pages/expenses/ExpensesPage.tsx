import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Plus, Trash2, Wallet } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { BreakdownBars } from "@/components/charts/SalesChart";
import { DateRangePicker, useRange } from "@/components/common/DateRange";
import { ExportMenu } from "@/components/common/ExportMenu";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Card, CardHeader, EmptyState, Money, PageHeader } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { fmtDate, todayISO } from "@/lib/dates";
import { fileUrl, supabase, toAppError, unwrap } from "@/lib/supabase";
import { uuid } from "@/lib/utils";

interface Expense {
  id: string; outlet_id: string | null; category_id: string; expense_date: string; amount: number; payment_method: string;
  reference: string | null; payee: string | null; description: string | null; attachment_path: string | null;
  expense_categories: { name: string }; outlets: { name: string } | null;
}

const methods = { cash: "Cash", card: "Card", bank_transfer: "Bank transfer", other: "Other" };

export default function ExpensesPage() {
  const orgId = useOrgId();
  const { can, outlets, outlet } = useOrg();
  const qc = useQueryClient();
  const [range, setRange] = useRange("mtd");
  const [edit, setEdit] = React.useState<Partial<Expense> | null>(null);
  const [del, setDel] = React.useState<Expense | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);

  const cats = useQuery({ queryKey: ["expense-categories", orgId], queryFn: async () => unwrap(await supabase.from("expense_categories").select("id, name").eq("organization_id", orgId).eq("is_active", true).order("name")) as { id: string; name: string }[] });
  const list = useQuery({
    queryKey: ["expenses", orgId, range.from, range.to],
    queryFn: async () => unwrap(await supabase.from("expenses").select("*, expense_categories(name), outlets(name)").eq("organization_id", orgId)
      .gte("expense_date", range.from).lte("expense_date", range.to).order("expense_date", { ascending: false }).order("created_at", { ascending: false })) as unknown as Expense[],
  });
  const rows = list.data ?? [];
  const byCat = Object.entries(rows.reduce<Record<string, number>>((m, e) => ({ ...m, [e.expense_categories.name]: (m[e.expense_categories.name] ?? 0) + Number(e.amount) }), {}))
    .map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, e) => s + Number(e.amount), 0);

  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      let attachment_path = edit.attachment_path ?? null;
      if (file) {
        const path = `${orgId}/expenses/${uuid()}.${file.name.split(".").pop()?.toLowerCase() ?? "bin"}`;
        const { error } = await supabase.storage.from("org-files").upload(path, file, { contentType: file.type });
        if (error) throw new Error(`Receipt upload failed: ${error.message}`);
        attachment_path = path;
      }
      const row = { outlet_id: edit.outlet_id || null, category_id: edit.category_id, expense_date: edit.expense_date, amount: edit.amount,
        payment_method: edit.payment_method ?? "cash", reference: edit.reference || null, payee: edit.payee || null, description: edit.description || null, attachment_path };
      const res = edit.id ? await supabase.from("expenses").update(row).eq("id", edit.id) : await supabase.from("expenses").insert({ ...row, organization_id: orgId });
      if (res.error) throw toAppError(res.error);
      toast.success("Expense saved");
      qc.invalidateQueries({ queryKey: ["expenses"] });
      setEdit(null);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  const valid = edit && edit.category_id && edit.expense_date && /^\d+(\.\d{1,2})?$/.test(String(edit.amount ?? "")) && Number(edit.amount) > 0;
  return (
    <>
      <PageHeader title="Expenses" description="Running costs like rent, utilities and wages. Stock purchases belong in Purchases so they flow into cost of goods."
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <ExportMenu rows={rows} filename={`expenses-${range.from}-${range.to}`} title="Expenses" subtitle={`${range.from} to ${range.to}`} columns={[
              { header: "Date", value: (e) => e.expense_date }, { header: "Category", value: (e) => e.expense_categories.name }, { header: "Payee", value: (e) => e.payee },
              { header: "Description", value: (e) => e.description }, { header: "Outlet", value: (e) => e.outlets?.name ?? "Business-wide" },
              { header: "Paid by", value: (e) => methods[e.payment_method as keyof typeof methods] }, { header: "Reference", value: (e) => e.reference },
              { header: "Amount", value: (e) => e.amount, numeric: true }]} />
            {can("expenses.manage") && <Button size="sm" onClick={() => { setFile(null); setEdit({ expense_date: todayISO(), payment_method: "cash", outlet_id: outlet?.id ?? null }); }}><Plus /> Record expense</Button>}
          </>
        } />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card>
          <Table>
            <THead><tr><Th>Date</Th><Th>Category</Th><Th>Payee / description</Th><Th>Outlet</Th><Th align="end">Amount (MVR)</Th><Th /></tr></THead>
            {list.isLoading ? <TableSkeleton cols={5} /> : (
              <tbody>
                {rows.map((e) => (
                  <Tr key={e.id} onClick={can("expenses.manage") ? () => { setFile(null); setEdit(e); } : undefined}>
                    <Td className="whitespace-nowrap text-muted">{fmtDate(e.expense_date)}</Td>
                    <Td>{e.expense_categories.name}</Td>
                    <Td><span className="font-medium">{e.payee ?? ""}</span> <span className="text-muted">{e.description}</span></Td>
                    <Td className="text-muted">{e.outlets?.name ?? "Business-wide"}</Td>
                    <Td align="end" className="font-medium"><Money value={e.amount} plain /></Td>
                    <Td align="end">
                      {e.attachment_path && <Button variant="ghost" size="icon-sm" aria-label="Open receipt" onClick={async (ev) => { ev.stopPropagation(); const u = await fileUrl(e.attachment_path); if (u) window.open(u, "_blank"); else toast.error("Receipt file unavailable"); }}><Paperclip /></Button>}
                      {can("expenses.manage") && <Button variant="ghost" size="icon-sm" aria-label="Delete expense" onClick={(ev) => { ev.stopPropagation(); setDel(e); }}><Trash2 /></Button>}
                    </Td>
                  </Tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6}><EmptyState icon={Wallet} title="No expenses in this period" /></td></tr>}
              </tbody>
            )}
          </Table>
        </Card>
        <Card className="h-fit">
          <CardHeader title="By category" description={<>Total <Money value={total} className="font-semibold text-fg" /></>} />
          <div className="p-4">{byCat.length ? <BreakdownBars rows={byCat} /> : <p className="text-sm text-muted">Nothing recorded.</p>}</div>
        </Card>
      </div>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title={edit?.id ? "Edit expense" : "Record an expense"}>
          {edit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Category" htmlFor="ex-cat"><Select id="ex-cat" value={edit.category_id ?? ""} onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}>
                <option value="" disabled>Choose</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
              <Field label="Amount (MVR)" htmlFor="ex-amt"><Input id="ex-amt" inputMode="decimal" value={edit.amount ?? ""} onChange={(e) => setEdit({ ...edit, amount: e.target.value as unknown as number })} /></Field>
              <Field label="Date" htmlFor="ex-date"><Input id="ex-date" type="date" value={edit.expense_date ?? ""} onChange={(e) => setEdit({ ...edit, expense_date: e.target.value })} /></Field>
              <Field label="Outlet" htmlFor="ex-outlet"><Select id="ex-outlet" value={edit.outlet_id ?? ""} onChange={(e) => setEdit({ ...edit, outlet_id: e.target.value || null })}>
                <option value="">Business-wide</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
              <Field label="Paid by" htmlFor="ex-pm"><Select id="ex-pm" value={edit.payment_method ?? "cash"} onChange={(e) => setEdit({ ...edit, payment_method: e.target.value })}>
                {Object.entries(methods).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
              <Field label="Payee" htmlFor="ex-payee"><Input id="ex-payee" value={edit.payee ?? ""} onChange={(e) => setEdit({ ...edit, payee: e.target.value })} placeholder="e.g. STELCO" /></Field>
              <Field label="Reference" htmlFor="ex-ref"><Input id="ex-ref" value={edit.reference ?? ""} onChange={(e) => setEdit({ ...edit, reference: e.target.value })} /></Field>
              <Field label="Receipt (image or PDF)" htmlFor="ex-file" hint={edit.attachment_path ? "A receipt is attached; choose a file to replace it." : "Optional, up to 5 MB."}>
                <Input id="ex-file" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-1.5" />
              </Field>
              <Field label="Description" htmlFor="ex-desc" className="sm:col-span-2"><Textarea id="ex-desc" value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className="min-h-14" /></Field>
            </div>
          )}
          {edit?.payment_method === "cash" && <p className="mt-2 text-xs text-muted">Paid from the till? Also record a cash-out on the shift so the drawer balances.</p>}
          <DialogFooter><Button disabled={!valid} loading={busy} onClick={save}>Save expense</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete this expense?" danger confirmLabel="Delete expense"
        description="The deletion is recorded in the audit log." onConfirm={async () => {
          const { error } = await supabase.from("expenses").delete().eq("id", del!.id);
          if (error) { toast.error(toAppError(error).message); throw error; }
          qc.invalidateQueries({ queryKey: ["expenses"] });
        }} />
    </>
  );
}
