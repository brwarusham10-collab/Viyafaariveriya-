import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { LogoMark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/misc";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDateTime } from "@/lib/dates";
import { exportCsv } from "@/lib/export";
import { fileUrl, supabase, toAppError, unwrap } from "@/lib/supabase";
import type { Organization, PaymentMethod, TaxRate } from "@/lib/types";

function useSave() {
  const qc = useQueryClient();
  const { refetch } = useOrg();
  return async (p: PromiseLike<{ error: unknown }>, msg = "Saved") => {
    const { error } = await p;
    if (error) { toast.error(toAppError(error as Error).message); return false; }
    toast.success(msg);
    refetch();
    qc.invalidateQueries({ queryKey: ["org-config"] });
    return true;
  };
}

function BusinessTab({ org }: { org: Organization }) {
  const [f, setF] = React.useState(org);
  const [logo, setLogo] = React.useState<string | null>(null);
  const save = useSave();
  React.useEffect(() => setF(org), [org]);
  React.useEffect(() => { fileUrl(org.logo_path).then(setLogo); }, [org.logo_path]);
  const set = (k: keyof Organization) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card className="p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" htmlFor="b-name"><Input id="b-name" value={f.name} onChange={set("name")} /></Field>
        <Field label="Registered name" htmlFor="b-legal"><Input id="b-legal" value={f.legal_name ?? ""} onChange={set("legal_name")} /></Field>
        <Field label="TIN" htmlFor="b-tin"><Input id="b-tin" value={f.tin ?? ""} onChange={set("tin")} /></Field>
        <Field label="GST registration no." htmlFor="b-gst"><Input id="b-gst" value={f.gst_registration ?? ""} onChange={set("gst_registration")} /></Field>
        <Field label="Business registration no." htmlFor="b-brn"><Input id="b-brn" value={f.business_registration ?? ""} onChange={set("business_registration")} /></Field>
        <Field label="Phone" htmlFor="b-phone"><Input id="b-phone" value={f.phone ?? ""} onChange={set("phone")} /></Field>
        <Field label="Email" htmlFor="b-email"><Input id="b-email" value={f.email ?? ""} onChange={set("email")} /></Field>
        <Field label="Island" htmlFor="b-island"><Input id="b-island" value={f.island ?? ""} onChange={set("island")} /></Field>
        <Field label="Atoll" htmlFor="b-atoll"><Input id="b-atoll" value={f.atoll ?? ""} onChange={set("atoll")} /></Field>
        <Field label="Address" htmlFor="b-addr"><Input id="b-addr" value={f.address ?? ""} onChange={set("address")} /></Field>
        <Field label="Currency" htmlFor="b-cur" hint="MVR today; multi-currency selling is planned."><Input id="b-cur" value={f.currency} disabled /></Field>
        <Field label="Time zone" htmlFor="b-tz"><Input id="b-tz" value={f.timezone} disabled /></Field>
        <Field label="Logo" htmlFor="b-logo" hint="PNG, JPG or WebP up to 5 MB. Stored privately.">
          <div className="flex items-center gap-3">
            {logo ? <img src={logo} alt="Logo" className="size-10 rounded object-contain" /> : <LogoMark className="size-10 opacity-40" />}
            <Input id="b-logo" type="file" accept="image/png,image/jpeg,image/webp" className="py-1.5" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const path = `${org.id}/branding/logo-${Date.now()}.${file.name.split(".").pop()}`;
              const { error } = await supabase.storage.from("org-files").upload(path, file, { contentType: file.type });
              if (error) return toast.error(`Upload failed: ${error.message}`);
              await save(supabase.from("organizations").update({ logo_path: path }).eq("id", org.id), "Logo updated");
            }} />
          </div>
        </Field>
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={() => save(supabase.from("organizations").update({ name: f.name, legal_name: f.legal_name || null, tin: f.tin || null, gst_registration: f.gst_registration || null,
          business_registration: f.business_registration || null, phone: f.phone || null, email: f.email || null, island: f.island || null, atoll: f.atoll || null, address: f.address || null }).eq("id", org.id))}>Save business details</Button>
      </div>
    </Card>
  );
}

function SellingTab({ org }: { org: Organization }) {
  const [f, setF] = React.useState(org);
  const save = useSave();
  React.useEffect(() => setF(org), [org]);
  return (
    <Card className="space-y-5 p-5">
      {[
        { k: "prices_include_tax", l: "Shelf prices include tax", h: "Changes apply to new sales only; past invoices keep the rule they were sold under." },
        { k: "allow_negative_stock", l: "Allow selling below zero stock", h: "Off: the register blocks sales that exceed on-hand stock. On: sales go through and stock goes negative until you receive more." },
      ].map((x) => (
        <label key={x.k} className="flex items-start gap-3">
          <Switch checked={f[x.k as keyof Organization] as boolean} onCheckedChange={(v) => setF({ ...f, [x.k]: v })} className="mt-0.5" />
          <span><span className="block text-sm font-medium">{x.l}</span><span className="block text-xs text-muted">{x.h}</span></span>
        </label>
      ))}
      <Field label="Receipt header" htmlFor="r-head" hint="Printed under your business details."><Textarea id="r-head" value={f.receipt_header ?? ""} onChange={(e) => setF({ ...f, receipt_header: e.target.value })} className="min-h-14" /></Field>
      <Field label="Receipt footer" htmlFor="r-foot" hint="e.g. returns policy or a thank-you line."><Textarea id="r-foot" value={f.receipt_footer ?? ""} onChange={(e) => setF({ ...f, receipt_footer: e.target.value })} className="min-h-14" /></Field>
      <div className="flex justify-end">
        <Button onClick={() => save(supabase.from("organizations").update({ prices_include_tax: f.prices_include_tax, allow_negative_stock: f.allow_negative_stock,
          receipt_header: f.receipt_header || null, receipt_footer: f.receipt_footer || null }).eq("id", org.id))}>Save selling settings</Button>
      </div>
    </Card>
  );
}

function TaxesTab() {
  const orgId = useOrgId();
  const { taxRates } = useOrg();
  const save = useSave();
  const [draft, setDraft] = React.useState({ name: "", rate: "" });
  return (
    <Card>
      <CardHeader title="Tax rates" description="Assign a rate per product, or leave products on the default. Rates you no longer use can be deactivated." />
      <Table>
        <THead><tr><Th>Name</Th><Th align="end">Rate %</Th><Th>Default</Th><Th>Active</Th></tr></THead>
        <tbody>
          {taxRates.map((t: TaxRate) => (
            <Tr key={t.id}>
              <Td>{t.name}</Td><Td align="end">{Number(t.rate)}</Td>
              <Td><input type="radio" name="def" aria-label={`Make ${t.name} default`} className="accent-[var(--lagoon)]" checked={t.is_default} onChange={async () => {
                await supabase.from("tax_rates").update({ is_default: false }).eq("organization_id", orgId).eq("is_default", true);
                await save(supabase.from("tax_rates").update({ is_default: true }).eq("id", t.id), `${t.name} is now the default`);
              }} /></Td>
              <Td><Switch checked={t.is_active} onCheckedChange={(v) => save(supabase.from("tax_rates").update({ is_active: v }).eq("id", t.id))} aria-label="Active" /></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <form className="flex flex-wrap gap-2 border-t border-line p-3" onSubmit={async (e) => {
        e.preventDefault();
        if (await save(supabase.from("tax_rates").insert({ organization_id: orgId, name: draft.name, rate: draft.rate }), "Tax rate added")) setDraft({ name: "", rate: "" });
      }}>
        <Input placeholder="Name, e.g. TGST" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-48" aria-label="Tax name" />
        <Input placeholder="Rate %" inputMode="decimal" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} className="w-28" aria-label="Rate" />
        <Button type="submit" variant="secondary" disabled={!draft.name.trim() || !/^\d{1,3}(\.\d{1,3})?$/.test(draft.rate) || Number(draft.rate) > 100}><Plus /> Add rate</Button>
      </form>
      <p className="border-t border-line px-4 py-2 text-xs text-muted">Changing a rate affects new sales only. Each invoice line stores the rate it was charged at.</p>
    </Card>
  );
}

function PaymentsTab() {
  const orgId = useOrgId();
  const { paymentMethods } = useOrg();
  const save = useSave();
  const [draft, setDraft] = React.useState({ name: "", kind: "bank_transfer" });
  const flag = (m: PaymentMethod, k: keyof PaymentMethod, label: string, disabled = false) => (
    <label className="flex items-center gap-1.5 text-xs"><Switch checked={m[k] as boolean} disabled={disabled} onCheckedChange={(v) => save(supabase.from("payment_methods").update({ [k]: v }).eq("id", m.id))} aria-label={label} /> {label}</label>
  );
  return (
    <Card>
      <CardHeader title="Payment types" description="BML, MIB and other transfers are recorded manually with a reference. Nothing here connects to a bank." />
      <ul className="divide-y divide-line">
        {paymentMethods.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
            <span className="w-44 text-sm font-medium">{m.name} <Badge className="ms-1">{m.kind.replace("_", " ")}</Badge></span>
            {flag(m, "requires_reference", "Needs reference")}
            {flag(m, "requires_verification", "Pending until verified", m.kind !== "bank_transfer")}
            {flag(m, "allowed_offline", "Allowed offline", !["cash", "card", "other"].includes(m.kind))}
            {flag(m, "is_active", "Active")}
          </li>
        ))}
      </ul>
      <form className="flex flex-wrap gap-2 border-t border-line p-3" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await save(supabase.from("payment_methods").insert({ organization_id: orgId, name: draft.name, kind: draft.kind,
          requires_reference: draft.kind === "bank_transfer", requires_verification: draft.kind === "bank_transfer", sort_order: paymentMethods.length + 1 }), "Payment type added");
        if (ok) setDraft({ name: "", kind: "bank_transfer" });
      }}>
        <Input placeholder="Name, e.g. BML transfer" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-56" aria-label="Payment type name" />
        <Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} className="w-44" aria-label="Kind">
          <option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="other">Other</option>
        </Select>
        <Button type="submit" variant="secondary" disabled={!draft.name.trim()}><Plus /> Add payment type</Button>
      </form>
    </Card>
  );
}

function NumberingTab() {
  const orgId = useOrgId();
  const { allOutlets } = useOrg();
  const save = useSave();
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["sequences", orgId], queryFn: async () => unwrap(await supabase.from("document_sequences").select("*").eq("organization_id", orgId).order("doc_type")) as { id: string; outlet_id: string | null; doc_type: string; prefix: string; next_number: number; padding: number }[] });
  const [edits, setEdits] = React.useState<Record<string, { prefix: string; next_number: string }>>({});
  return (
    <Card>
      <CardHeader title="Document numbering" description="Numbers are issued by the server in strict sequence. You can change the prefix or skip ahead, never go back." />
      <Table>
        <THead><tr><Th>Document</Th><Th>Outlet</Th><Th>Prefix</Th><Th align="end">Next number</Th><Th>Preview</Th><Th /></tr></THead>
        <tbody>
          {data.map((s) => {
            const e = edits[s.id] ?? { prefix: s.prefix, next_number: String(s.next_number) };
            return (
              <Tr key={s.id}>
                <Td className="capitalize">{s.doc_type.replace("_", " ")}</Td>
                <Td className="text-muted">{allOutlets.find((o) => o.id === s.outlet_id)?.name ?? "All"}</Td>
                <Td><Input aria-label="Prefix" value={e.prefix} onChange={(ev) => setEdits({ ...edits, [s.id]: { ...e, prefix: ev.target.value } })} className="h-8 w-28" /></Td>
                <Td align="end"><Input aria-label="Next number" inputMode="numeric" value={e.next_number} onChange={(ev) => setEdits({ ...edits, [s.id]: { ...e, next_number: ev.target.value.replace(/\D/g, "") } })} className="ms-auto h-8 w-24 text-end" /></Td>
                <Td className="text-muted tabular">{e.prefix}{e.next_number.padStart(s.padding, "0")}</Td>
                <Td>{edits[s.id] && <Button size="sm" variant="secondary" onClick={async () => {
                  if (await save(supabase.from("document_sequences").update({ prefix: e.prefix, next_number: Number(e.next_number) }).eq("id", s.id))) {
                    setEdits((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== s.id))); qc.invalidateQueries({ queryKey: ["sequences"] });
                  }
                }}>Save</Button>}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}

function ListsTab() {
  const orgId = useOrgId();
  const save = useSave();
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ["customer-groups", orgId], queryFn: async () => unwrap(await supabase.from("customer_groups").select("*").eq("organization_id", orgId).order("name")) as { id: string; name: string; price_list: string; discount_percent: number }[] });
  const cats = useQuery({ queryKey: ["expense-categories-all", orgId], queryFn: async () => unwrap(await supabase.from("expense_categories").select("*").eq("organization_id", orgId).order("name")) as { id: string; name: string; is_active: boolean }[] });
  const [g, setG] = React.useState({ name: "", price_list: "retail", discount_percent: "" });
  const [c, setC] = React.useState("");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Customer groups" description="Wholesale price list and/or a standing percentage off." />
        <ul className="divide-y divide-line text-sm">{groups.data?.map((x) => <li key={x.id} className="flex justify-between px-4 py-2"><span>{x.name}</span><span className="text-muted">{x.price_list}{Number(x.discount_percent) ? ` · ${Number(x.discount_percent)}% off` : ""}</span></li>)}</ul>
        <form className="flex flex-wrap gap-2 border-t border-line p-3" onSubmit={async (e) => {
          e.preventDefault();
          if (await save(supabase.from("customer_groups").insert({ organization_id: orgId, name: g.name, price_list: g.price_list, discount_percent: g.discount_percent || 0 }), "Group added")) {
            setG({ name: "", price_list: "retail", discount_percent: "" }); qc.invalidateQueries({ queryKey: ["customer-groups"] });
          }
        }}>
          <Input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="Group name" className="w-40" aria-label="Group name" />
          <Select value={g.price_list} onChange={(e) => setG({ ...g, price_list: e.target.value })} className="w-32" aria-label="Price list"><option value="retail">Retail</option><option value="wholesale">Wholesale</option></Select>
          <Input value={g.discount_percent} onChange={(e) => setG({ ...g, discount_percent: e.target.value })} placeholder="% off" className="w-20" aria-label="Discount percent" />
          <Button type="submit" variant="secondary" disabled={!g.name.trim()}><Plus /> Add</Button>
        </form>
      </Card>
      <Card>
        <CardHeader title="Expense categories" />
        <ul className="divide-y divide-line text-sm">{cats.data?.map((x) => <li key={x.id} className="flex items-center justify-between px-4 py-2"><span>{x.name}</span>
          <Switch checked={x.is_active} aria-label="Active" onCheckedChange={async (v) => { await save(supabase.from("expense_categories").update({ is_active: v }).eq("id", x.id)); qc.invalidateQueries({ queryKey: ["expense-categories-all"] }); }} /></li>)}</ul>
        <form className="flex gap-2 border-t border-line p-3" onSubmit={async (e) => {
          e.preventDefault();
          if (await save(supabase.from("expense_categories").insert({ organization_id: orgId, name: c }), "Category added")) { setC(""); qc.invalidateQueries({ queryKey: ["expense-categories-all"] }); qc.invalidateQueries({ queryKey: ["expense-categories"] }); }
        }}>
          <Input value={c} onChange={(e) => setC(e.target.value)} placeholder="Category name" className="flex-1" aria-label="Category name" />
          <Button type="submit" variant="secondary" disabled={!c.trim()}><Plus /> Add</Button>
        </form>
      </Card>
    </div>
  );
}

interface AuditRow { id: number; action: string; entity: string | null; details: Record<string, unknown>; created_at: string; user_id: string | null }

function AuditTab() {
  const orgId = useOrgId();
  const [action, setAction] = React.useState("");
  const q = useInfiniteQuery({
    queryKey: ["audit", orgId, action],
    initialPageParam: 0,
    getNextPageParam: (last: AuditRow[], all) => (last.length === 100 ? all.length * 100 : undefined),
    queryFn: async ({ pageParam }) => {
      let s = supabase.from("audit_logs").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).range(pageParam, pageParam + 99);
      if (action) s = s.ilike("action", `${action}%`);
      return unwrap(await s) as AuditRow[];
    },
  });
  const names = useQuery({ queryKey: ["member-names", orgId], queryFn: async () => unwrap(await supabase.rpc("member_names", { p_org: orgId })) as { user_id: string; display_name: string }[] });
  const rows = q.data?.pages.flat() ?? [];
  const who = (id: string | null) => names.data?.find((n) => n.user_id === id)?.display_name ?? (id ? "Former member" : "System");
  return (
    <Card>
      <CardHeader title="Audit log" description="Sensitive actions: price overrides, refunds, voids, credit, cash movements, stock adjustments and settings changes. Entries can't be edited or deleted."
        action={<Select aria-label="Filter" value={action} onChange={(e) => setAction(e.target.value)} className="h-8 w-44">
          <option value="">Everything</option><option value="sale.">Refunds & voids</option><option value="pos.">Overrides & credit</option><option value="cash.">Cash in/out</option>
          <option value="shift.">Shifts</option><option value="stock.">Stock</option><option value="payment.">Payment verification</option><option value="staff.">Staff</option></Select>} />
      <Table>
        <THead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Details</Th></tr></THead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td className="whitespace-nowrap text-muted">{fmtDateTime(r.created_at)}</Td><Td>{who(r.user_id)}</Td><Td className="font-medium">{r.action}</Td>
              <Td className="max-w-md truncate text-xs text-muted" >{Object.entries(r.details).filter(([k]) => !["before", "after"].includes(k)).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {q.hasNextPage && <div className="border-t border-line p-3 text-center"><Button size="sm" variant="secondary" onClick={() => q.fetchNextPage()}>Load more</Button></div>}
    </Card>
  );
}

function DataTab() {
  const orgId = useOrgId();
  const [busy, setBusy] = React.useState<string | null>(null);
  const tables = [
    ["products", "Products"], ["product_variants", "Variants & prices"], ["customers", "Customers"], ["suppliers", "Suppliers"], ["sales", "Sales"],
    ["sale_items", "Sale lines"], ["payments", "Payments"], ["refunds", "Refunds"], ["inventory_balances", "Stock on hand"], ["inventory_movements", "Stock ledger"], ["expenses", "Expenses"],
  ] as const;
  return (
    <Card>
      <CardHeader title="Export your data" description="Raw CSV extracts of what your role can see. For full database backups see the README (Supabase point-in-time recovery)." />
      <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map(([t, l]) => (
          <Button key={t} variant="secondary" loading={busy === t} className="justify-start" onClick={async () => {
            setBusy(t);
            try {
              const rows: Record<string, unknown>[] = [];
              for (let from = 0; ; from += 1000) {
                const page = unwrap(await supabase.from(t).select("*").eq("organization_id", orgId).range(from, from + 999)) as Record<string, unknown>[];
                rows.push(...page);
                if (page.length < 1000) break;
              }
              if (!rows.length) { toast.message(`No ${l.toLowerCase()} to export`); return; }
              exportCsv(rows, Object.keys(rows[0]).map((k) => ({ header: k, value: (r: Record<string, unknown>) => (typeof r[k] === "object" && r[k] !== null ? JSON.stringify(r[k]) : r[k] as string) })), t);
            } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
          }}><Download /> {l}</Button>
        ))}
      </div>
    </Card>
  );
}

function SecurityTab() {
  const [pw, setPw] = React.useState("");
  return (
    <Card className="max-w-lg p-5">
      <h2 className="font-display font-semibold">Change your password</h2>
      <form className="mt-3 flex gap-2" onSubmit={async (e) => {
        e.preventDefault();
        const { error } = await supabase.auth.updateUser({ password: pw });
        if (error) return toast.error(error.message);
        setPw(""); toast.success("Password changed");
      }}>
        <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (8+ characters)" aria-label="New password" />
        <Button type="submit" disabled={pw.length < 8}>Update</Button>
      </form>
      <p className="mt-4 text-xs text-muted">Signing out of the register on a shared device also removes its offline catalogue. Unsynced offline sales are kept until they sync.</p>
    </Card>
  );
}

export default function SettingsPage() {
  const { org, can } = useOrg();
  if (!org) return null;
  const manage = can("settings.manage");
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs defaultValue={manage ? "business" : "audit"}>
        <TabsList className="mb-4">
          {manage && <><TabsTrigger value="business">Business</TabsTrigger><TabsTrigger value="selling">Selling & receipts</TabsTrigger><TabsTrigger value="taxes">Taxes</TabsTrigger>
            <TabsTrigger value="payments">Payment types</TabsTrigger><TabsTrigger value="numbering">Numbering</TabsTrigger><TabsTrigger value="lists">Groups & categories</TabsTrigger></>}
          {can("audit.view") && <TabsTrigger value="audit">Audit log</TabsTrigger>}
          {manage && <TabsTrigger value="data">Data export</TabsTrigger>}
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
        {manage && <>
          <TabsContent value="business"><BusinessTab org={org} /></TabsContent>
          <TabsContent value="selling"><SellingTab org={org} /></TabsContent>
          <TabsContent value="taxes"><TaxesTab /></TabsContent>
          <TabsContent value="payments"><PaymentsTab /></TabsContent>
          <TabsContent value="numbering"><NumberingTab /></TabsContent>
          <TabsContent value="lists"><ListsTab /></TabsContent>
          <TabsContent value="data"><DataTab /></TabsContent>
        </>}
        {can("audit.view") && <TabsContent value="audit"><AuditTab /></TabsContent>}
        <TabsContent value="security"><SecurityTab /></TabsContent>
      </Tabs>
    </>
  );
}
