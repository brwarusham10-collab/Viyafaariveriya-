import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/app/auth";
import { useOrg } from "@/app/org";
import { Wordmark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Card } from "@/components/ui/misc";
import { fmtDate } from "@/lib/dates";
import { rpc, supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";

interface TaxRow {
  name: string;
  rate: string;
  is_default: boolean;
}

const steps = ["Business", "Outlet", "Tax & pricing", "Team"] as const;

function Invitations() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setOrg = useSession((s) => s.setOrg);
  const { data } = useQuery({
    queryKey: ["my-invitations"],
    queryFn: () => rpc<{ id: string; organization_name: string; role_name: string; expires_at: string }[]>("my_invitations"),
  });
  if (!data?.length) return null;
  return (
    <Card className="mb-6 p-4">
      <h2 className="font-display text-base font-semibold">You've been invited</h2>
      <ul className="mt-3 divide-y divide-line">
        {data.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
            <div>
              <div className="font-medium">{i.organization_name}</div>
              <div className="text-xs text-muted">
                As {i.role_name} · expires {fmtDate(i.expires_at)}
              </div>
            </div>
            <Button
              size="sm"
              onClick={async () => {
                try {
                  const orgId = await rpc<string>("accept_invitation", { p_invitation: i.id });
                  setOrg(orgId);
                  await qc.invalidateQueries({ queryKey: ["memberships"] });
                  navigate("/");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}>
              Join business
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function OnboardingPage() {
  const { user, signOut } = useAuth();
  const { memberships } = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setOrg = useSession((s) => s.setOrg);
  const [step, setStep] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "",
    legal_name: "",
    tin: "",
    gst_registration: "",
    business_registration: "",
    phone: "",
    email: user?.email ?? "",
    island: "",
    atoll: "",
    address: "",
    display_name: "",
    outlet_name: "",
    outlet_code: "MAIN",
    outlet_island: "",
    register_name: "Register 1",
    prices_include_tax: true,
    invite_email: "",
    invite_role: "cashier",
  });
  const [taxes, setTaxes] = React.useState<TaxRow[]>([
    { name: "GST", rate: "", is_default: true },
    { name: "Zero-rated", rate: "0", is_default: false },
  ]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const errors: string[] = [];
  if (step === 0 && form.name.trim().length < 2) errors.push("Enter your business name.");
  if (step === 1 && !/^[A-Z0-9]{2,6}$/.test(form.outlet_code)) errors.push("Outlet code: 2–6 capital letters or digits.");
  if (step === 2) {
    taxes.forEach((t, i) => {
      if (!t.name.trim()) errors.push(`Tax ${i + 1}: add a name.`);
      if (t.rate === "" || Number.isNaN(Number(t.rate)) || Number(t.rate) < 0 || Number(t.rate) > 100) errors.push(`${t.name || `Tax ${i + 1}`}: enter a rate from 0 to 100.`);
    });
  }
  if (step === 3 && form.invite_email && !/^\S+@\S+\.\S+$/.test(form.invite_email)) errors.push("Check the staff email address.");

  async function finish() {
    setBusy(true);
    try {
      const orgId = await rpc<string>("create_organization", {
        payload: {
          name: form.name.trim(),
          legal_name: form.legal_name || null,
          tin: form.tin || null,
          gst_registration: form.gst_registration || null,
          business_registration: form.business_registration || null,
          phone: form.phone || null,
          email: form.email || null,
          island: form.island || null,
          atoll: form.atoll || null,
          address: form.address || null,
          display_name: form.display_name || null,
          prices_include_tax: form.prices_include_tax,
          outlet: { name: form.outlet_name || form.name, code: form.outlet_code, island: form.outlet_island || form.island || null },
          register_name: form.register_name,
          taxes: taxes.map((t) => ({ name: t.name.trim(), rate: Number(t.rate), is_default: t.is_default })),
        },
      });
      if (form.invite_email) {
        const { data: role } = await supabase.from("roles").select("id").eq("organization_id", orgId).eq("system_key", form.invite_role).single();
        if (role) await rpc("invite_staff", { p_org: orgId, p_email: form.invite_email, p_role: role.id, p_outlet_ids: null, p_display_name: null });
      }
      setOrg(orgId);
      await qc.invalidateQueries({ queryKey: ["memberships"] });
      toast.success(`${form.name} is ready. Add your first products next.`);
      navigate("/products/new");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-dvh bg-bg">
      <header className="flex h-14 items-center justify-between border-b border-line bg-surface px-6">
        <Wordmark />
        <div className="flex items-center gap-3 text-sm text-muted">
          {memberships.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              Back to app
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <div className="mx-auto grid max-w-4xl gap-10 px-6 py-10 md:grid-cols-[200px_1fr]">
        <ol className="space-y-1 md:pt-14" aria-label="Setup steps">
          {steps.map((s, i) => (
            <li key={s} className={cn("flex items-center gap-3 rounded-md px-2 py-2 text-sm", i === step ? "font-semibold text-fg" : "text-muted")}>
              <span className={cn("grid size-6 place-items-center rounded-full border text-xs",
                i < step ? "border-lagoon bg-lagoon text-white" : i === step ? "border-lagoon text-lagoon" : "border-line-strong")}>
                {i < step ? <Check className="size-3.5" /> : i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
        <div>
          {step === 0 && <Invitations />}
          <h1 className="font-display text-[28px] font-semibold tracking-tight">
            {["Tell us about your business", "Set up your first outlet", "How you charge tax", "Bring in your team"][step]}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {[
              "These details print on invoices and the GST summary. You can change them later in Settings.",
              "An outlet is a place you sell from. It gets its own stock location, register and invoice numbers.",
              "Enter the rates that apply to your business. Check MIRA's current rates — nothing here is preset for you.",
              "Optional. They'll get access once they sign up with this email.",
            ][step]}
          </p>

          <Card className="mt-6 p-5">
            {step === 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name" htmlFor="name" className="sm:col-span-2">
                  <Input id="name" value={form.name} onChange={set("name")} placeholder="Maafushi Mart" autoFocus />
                </Field>
                <Field label="Registered (legal) name" htmlFor="legal">
                  <Input id="legal" value={form.legal_name} onChange={set("legal_name")} />
                </Field>
                <Field label="Business registration no." htmlFor="brn">
                  <Input id="brn" value={form.business_registration} onChange={set("business_registration")} placeholder="SP-…" />
                </Field>
                <Field label="TIN" htmlFor="tin">
                  <Input id="tin" value={form.tin} onChange={set("tin")} />
                </Field>
                <Field label="GST registration no." htmlFor="gst">
                  <Input id="gst" value={form.gst_registration} onChange={set("gst_registration")} />
                </Field>
                <Field label="Phone" htmlFor="phone">
                  <Input id="phone" value={form.phone} onChange={set("phone")} placeholder="+960 7xx xxxx" inputMode="tel" />
                </Field>
                <Field label="Email" htmlFor="bemail">
                  <Input id="bemail" type="email" value={form.email} onChange={set("email")} />
                </Field>
                <Field label="Island" htmlFor="island">
                  <Input id="island" value={form.island} onChange={set("island")} placeholder="Maafushi" />
                </Field>
                <Field label="Atoll" htmlFor="atoll">
                  <Input id="atoll" value={form.atoll} onChange={set("atoll")} placeholder="Kaafu" />
                </Field>
                <Field label="Address" htmlFor="address" className="sm:col-span-2">
                  <Input id="address" value={form.address} onChange={set("address")} placeholder="Building, street" />
                </Field>
                <Field label="Your name (shown on receipts)" htmlFor="display" className="sm:col-span-2">
                  <Input id="display" value={form.display_name} onChange={set("display_name")} />
                </Field>
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Outlet name" htmlFor="oname">
                  <Input id="oname" value={form.outlet_name} onChange={set("outlet_name")} placeholder={form.name || "Main shop"} autoFocus />
                </Field>
                <Field label="Outlet code" htmlFor="ocode" hint="Prefixes invoice numbers, e.g. MAIN-000001">
                  <Input id="ocode" value={form.outlet_code} onChange={(e) => setForm((f) => ({ ...f, outlet_code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) }))} />
                </Field>
                <Field label="Island" htmlFor="oisland">
                  <Input id="oisland" value={form.outlet_island} onChange={set("outlet_island")} placeholder={form.island} />
                </Field>
                <Field label="First register" htmlFor="reg">
                  <Input id="reg" value={form.register_name} onChange={set("register_name")} />
                </Field>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <label className="flex items-start gap-3">
                  <Switch checked={form.prices_include_tax} onCheckedChange={(v) => setForm((f) => ({ ...f, prices_include_tax: v }))} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">Shelf prices include tax</span>
                    <span className="block text-xs text-muted">
                      {form.prices_include_tax
                        ? "A MVR 108 price is what the customer pays; tax is calculated inside it."
                        : "Tax is added on top of the shelf price at checkout."}
                    </span>
                  </span>
                </label>
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_110px_90px_36px] gap-2 text-xs text-muted">
                    <span>Name</span>
                    <span>Rate %</span>
                    <span>Default</span>
                    <span />
                  </div>
                  {taxes.map((t, i) => (
                    <div key={i} className="grid grid-cols-[1fr_110px_90px_36px] items-center gap-2">
                      <Input aria-label="Tax name" value={t.name} onChange={(e) => setTaxes((ts) => ts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      <Input aria-label="Tax rate" inputMode="decimal" value={t.rate} placeholder="e.g. 8"
                        onChange={(e) => setTaxes((ts) => ts.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
                      <input type="radio" name="default-tax" aria-label="Default rate" className="size-4 accent-[var(--lagoon)]" checked={t.is_default}
                        onChange={() => setTaxes((ts) => ts.map((x, j) => ({ ...x, is_default: j === i })))} />
                      <Button variant="ghost" size="icon-sm" aria-label="Remove rate" onClick={() => setTaxes((ts) => ts.filter((_, j) => j !== i))}
                        disabled={taxes.length === 1}>
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <Button variant="secondary" size="sm" onClick={() => setTaxes((ts) => [...ts, { name: "", rate: "", is_default: false }])}>
                    <Plus /> Add rate
                  </Button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                <Field label="Staff email" htmlFor="invite">
                  <Input id="invite" type="email" value={form.invite_email} onChange={set("invite_email")} placeholder="cashier@yourshop.mv" />
                </Field>
                <Field label="Role" htmlFor="irole">
                  <Select id="irole" value={form.invite_role} onChange={set("invite_role")}>
                    <option value="cashier">Cashier</option>
                    <option value="admin">Manager</option>
                    <option value="inventory">Inventory</option>
                    <option value="accountant">Accountant</option>
                  </Select>
                </Field>
                <p className="text-xs text-muted sm:col-span-2">
                  We'll also create Cash, Card, Bank transfer, Store credit and Customer account payment types, plus starter units and
                  expense categories. All of it is editable.
                </p>
              </div>
            )}

            {errors.length > 0 && (
              <ul className="mt-4 space-y-0.5 text-xs text-muted" aria-live="polite">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <div className="mt-6 flex justify-between border-t border-line pt-4">
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
                Back
              </Button>
              {step < steps.length - 1 ? (
                <Button onClick={() => setStep((s) => s + 1)} disabled={errors.length > 0}>
                  Continue
                </Button>
              ) : (
                <Button onClick={finish} loading={busy} disabled={errors.length > 0}>
                  Create business
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
