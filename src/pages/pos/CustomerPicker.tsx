import { useQuery } from "@tanstack/react-query";
import { Plus, Search, UserRound } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Money } from "@/components/ui/misc";
import { supabase, toAppError, unwrap } from "@/lib/supabase";
import type { CartCustomer } from "./cartStore";

interface Row {
  id: string;
  name: string;
  phone: string | null;
  store_credit: number;
  account_balance: number;
  credit_limit: number;
  customer_groups: { price_list: "retail" | "wholesale"; discount_percent: number } | null;
}

export function toCartCustomer(r: Row): CartCustomer {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    store_credit: Number(r.store_credit),
    account_balance: Number(r.account_balance),
    credit_limit: Number(r.credit_limit),
    price_list: r.customer_groups?.price_list ?? "retail",
    discount_percent: Number(r.customer_groups?.discount_percent ?? 0),
  };
}

export const customerSelect = "id, name, phone, store_credit, account_balance, credit_limit, customer_groups(price_list, discount_percent)";

export function CustomerPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (c: CartCustomer) => void }) {
  const orgId = useOrgId();
  const { can } = useOrg();
  const [term, setTerm] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [draft, setDraft] = React.useState({ name: "", phone: "" });
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 200);
    return () => clearTimeout(t);
  }, [term]);
  React.useEffect(() => {
    if (open) {
      setTerm("");
      setCreating(false);
    }
  }, [open]);

  const { data, isLoading } = useQuery({
    queryKey: ["customer-search", orgId, debounced],
    enabled: open && can("customers.view"),
    queryFn: async () => {
      let q = supabase.from("customers").select(customerSelect).eq("organization_id", orgId).eq("is_active", true).order("name").limit(20);
      if (debounced) {
        const safe = debounced.replace(/[%,()]/g, " ");
        q = q.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`);
      }
      return unwrap(await q) as unknown as Row[];
    },
  });

  async function create() {
    try {
      const row = unwrap(
        await supabase.from("customers").insert({ organization_id: orgId, name: draft.name.trim(), phone: draft.phone.trim() || null }).select(customerSelect).single(),
      ) as unknown as Row;
      onPick(toCartCustomer(row));
      onOpenChange(false);
    } catch (e) {
      toast.error(toAppError(e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={creating ? "New customer" : "Attach a customer"} description={creating ? undefined : "Search by name or phone number."}>
        {creating ? (
          <div className="space-y-3">
            <Field label="Name" htmlFor="cname">
              <Input id="cname" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} autoFocus />
            </Field>
            <Field label="Phone" htmlFor="cphone">
              <Input id="cphone" inputMode="tel" value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
            </Field>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCreating(false)}>
                Back
              </Button>
              <Button onClick={create} disabled={!draft.name.trim()}>
                Save and attach
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name or phone" className="ps-9" autoFocus />
            </div>
            <ul className="mt-3 max-h-80 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {isLoading && <li className="px-3 py-3 text-sm text-muted">Searching…</li>}
              {!isLoading && data?.length === 0 && <li className="px-3 py-3 text-sm text-muted">No customers match “{debounced}”.</li>}
              {data?.map((c) => (
                <li key={c.id}>
                  <button className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-fg/[0.03]" onClick={() => {
                    onPick(toCartCustomer(c));
                    onOpenChange(false);
                  }}>
                    <UserRound className="size-4 text-subtle" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block text-xs text-muted">{c.phone ?? "No phone"}</span>
                    </span>
                    <span className="text-end text-xs text-muted">
                      {Number(c.account_balance) > 0 && (
                        <span className="block">
                          Owes <Money value={c.account_balance} />
                        </span>
                      )}
                      {Number(c.store_credit) > 0 && (
                        <span className="block text-ok">
                          Credit <Money value={c.store_credit} />
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {can("customers.manage") && (
              <Button variant="secondary" className="mt-3" onClick={() => {
                setDraft({ name: /\d{5,}/.test(term) ? "" : term, phone: /\d{5,}/.test(term) ? term : "" });
                setCreating(true);
              }}>
                <Plus /> New customer
              </Button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
