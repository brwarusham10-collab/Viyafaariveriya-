import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useOrg, useOrgId } from "@/app/org";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Card, EmptyState, Spinner } from "@/components/ui/misc";
import { fmtTime } from "@/lib/dates";
import { rpc, supabase, unwrap } from "@/lib/supabase";
import type { Register, Shift } from "@/lib/types";
import { useOnline } from "@/offline/hooks";
import { useSession } from "@/stores/session";
import { useCart } from "./cartStore";

/** Resolves the register and its open shift; renders the "open a shift" screen when needed. */
export function useRegisterShift() {
  const orgId = useOrgId();
  const { outlet, registers } = useOrg();
  const { registerId } = useSession();
  const online = useOnline();
  const remembered = useCart((s) => s.shiftByRegister);
  const outletRegisters = registers.filter((r) => r.outlet_id === outlet?.id && r.is_active);
  const register = outletRegisters.find((r) => r.id === registerId) ?? (outletRegisters.length === 1 ? outletRegisters[0] : null);

  const shift = useQuery({
    queryKey: ["open-shift", register?.id, online],
    enabled: !!register,
    queryFn: async (): Promise<Shift | null> => {
      if (!online) {
        const id = remembered[register!.id];
        return id ? ({ id, register_id: register!.id, status: "open", organization_id: orgId } as Shift) : null;
      }
      const row = unwrap(await supabase.from("shifts").select("*").eq("register_id", register!.id).eq("status", "open").maybeSingle()) as Shift | null;
      useCart.getState().rememberShift(register!.id, row?.id ?? null);
      return row;
    },
  });
  return { register, outletRegisters, shift: shift.data ?? null, loading: shift.isLoading, refetch: shift.refetch };
}

export function ShiftGate({ registers, register, onOpened }: { registers: Register[]; register: Register | null; onOpened: () => void }) {
  const { can, outlet } = useOrg();
  const setRegister = useSession((s) => s.setRegister);
  const online = useOnline();
  const qc = useQueryClient();
  const [float, setFloat] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const lastClose = useQuery({
    queryKey: ["last-closed-shift", register?.id],
    enabled: !!register && online,
    queryFn: async () =>
      unwrap(await supabase.from("shifts").select("closed_at, counted_cash").eq("register_id", register!.id).neq("status", "open")
        .order("closed_at", { ascending: false }).limit(1).maybeSingle()) as { closed_at: string; counted_cash: number } | null,
  });

  if (registers.length === 0) {
    return (
      <EmptyState icon={MonitorSmartphone} title="No register at this outlet" className="h-full">
        {can("settings.manage") ? "Add a register under Outlets to start selling here." : "Ask a manager to add a register for this outlet."}
      </EmptyState>
    );
  }

  return (
    <div className="grid h-full place-items-center p-6">
      <Card className="w-full max-w-md p-6">
        <h1 className="font-display text-xl font-semibold">Open the register</h1>
        <p className="mt-1 text-sm text-muted">
          Count the cash in the drawer before your first sale. Everything you take is reconciled against this at close.
        </p>
        <div className="mt-5 space-y-4">
          <Field label="Register" htmlFor="reg">
            <Select id="reg" value={register?.id ?? ""} onChange={(e) => setRegister(e.target.value)}>
              <option value="" disabled>
                Choose a register at {outlet?.name}
              </option>
              {registers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Opening cash float (MVR)" htmlFor="float"
            hint={lastClose.data ? `Last shift closed ${fmtTime(lastClose.data.closed_at)} with ${Number(lastClose.data.counted_cash).toFixed(2)} counted.` : undefined}>
            <Input id="float" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0.00" className="h-11 text-lg tabular" />
          </Field>
          {!online && <p className="text-sm text-coral">Opening a shift needs a connection.</p>}
          {!can("shifts.manage") && <p className="text-sm text-coral">Your role can't open shifts. Ask a manager to open one.</p>}
          <Button size="lg" className="w-full" loading={busy}
            disabled={!register || !online || !can("shifts.manage") || !/^\d*(\.\d{0,2})?$/.test(float)}
            onClick={async () => {
              setBusy(true);
              try {
                const id = await rpc<string>("open_shift", { p_register: register!.id, p_opening_float: Number(float || 0) });
                useCart.getState().rememberShift(register!.id, id);
                await qc.invalidateQueries({ queryKey: ["open-shift"] });
                toast.success(`${register!.name} is open`);
                onOpened();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}>
            Open shift
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function GateSpinner() {
  return (
    <div className="grid h-full place-items-center">
      <Spinner />
    </div>
  );
}
