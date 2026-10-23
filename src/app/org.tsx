import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { rpc, supabase, unwrap } from "@/lib/supabase";
import type { Membership, Organization, Outlet, PaymentMethod, Register, TaxRate, Warehouse } from "@/lib/types";
import { useSession } from "@/stores/session";
import { useAuth } from "./auth";

interface OrgState {
  memberships: Membership[];
  membership: Membership | null;
  org: Organization | null;
  outlets: Outlet[];          // outlets this user may access
  allOutlets: Outlet[];
  outlet: Outlet | null;
  warehouses: Warehouse[];
  registers: Register[];
  paymentMethods: PaymentMethod[];
  taxRates: TaxRate[];
  loading: boolean;
  can: (perm: string) => boolean;
  refetch: () => void;
}

const OrgContext = React.createContext<OrgState | null>(null);

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { orgId, outletId, setOrg, setOutlet } = useSession();

  const memberships = useQuery({
    queryKey: ["memberships", user?.id],
    enabled: !!user,
    queryFn: () => rpc<Membership[]>("my_memberships"),
  });

  const membership = React.useMemo(() => {
    const list = memberships.data ?? [];
    return list.find((m) => m.organization_id === orgId) ?? list[0] ?? null;
  }, [memberships.data, orgId]);
  const activeOrg = membership?.organization_id ?? null;

  React.useEffect(() => {
    if (activeOrg && activeOrg !== orgId) setOrg(activeOrg);
  }, [activeOrg, orgId, setOrg]);

  const config = useQuery({
    queryKey: ["org-config", activeOrg],
    enabled: !!activeOrg,
    queryFn: async () => {
      const [org, outlets, warehouses, registers, methods, taxes] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", activeOrg!).single(),
        supabase.from("outlets").select("*").eq("organization_id", activeOrg!).order("created_at"),
        supabase.from("warehouses").select("*").eq("organization_id", activeOrg!).order("name"),
        supabase.from("registers").select("*").eq("organization_id", activeOrg!).order("created_at"),
        supabase.from("payment_methods").select("*").eq("organization_id", activeOrg!).order("sort_order"),
        supabase.from("tax_rates").select("*").eq("organization_id", activeOrg!).order("rate", { ascending: false }),
      ]);
      return {
        org: unwrap(org) as Organization,
        outlets: unwrap(outlets) as Outlet[],
        warehouses: unwrap(warehouses) as Warehouse[],
        registers: unwrap(registers) as Register[],
        paymentMethods: unwrap(methods) as PaymentMethod[],
        taxRates: unwrap(taxes) as TaxRate[],
      };
    },
  });

  const allOutlets = React.useMemo(() => config.data?.outlets ?? [], [config.data]);
  const outlets = React.useMemo(() => {
    const allowed = membership?.system_key === "owner" ? null : membership?.outlet_ids;
    return allOutlets.filter((o) => o.is_active && (!allowed || allowed.includes(o.id)));
  }, [allOutlets, membership]);
  const outlet = outlets.find((o) => o.id === outletId) ?? outlets[0] ?? null;

  React.useEffect(() => {
    if (outlet && outlet.id !== outletId) setOutlet(outlet.id);
  }, [outlet, outletId, setOutlet]);

  const perms = React.useMemo(() => new Set(membership?.permissions ?? []), [membership]);

  const value: OrgState = {
    memberships: memberships.data ?? [],
    membership,
    org: config.data?.org ?? null,
    outlets,
    allOutlets,
    outlet,
    warehouses: config.data?.warehouses ?? [],
    registers: config.data?.registers ?? [],
    paymentMethods: config.data?.paymentMethods ?? [],
    taxRates: config.data?.taxRates ?? [],
    loading: memberships.isLoading || (!!activeOrg && config.isLoading),
    can: (p) => perms.has(p),
    refetch: () => {
      memberships.refetch();
      config.refetch();
    },
  };
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = React.useContext(OrgContext);
  if (!ctx) throw new Error("useOrg outside OrgProvider");
  return ctx;
}

/** Org id for queries; components under the app shell always have one. */
export function useOrgId(): string {
  const { membership } = useOrg();
  return membership?.organization_id ?? "";
}
