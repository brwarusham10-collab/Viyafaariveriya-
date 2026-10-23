import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, ShieldCheck, UserPlus, Users } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useAuth } from "@/app/auth";
import { useOrg, useOrgId } from "@/app/org";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TableSkeleton, Td, Th, THead, Tr } from "@/components/ui/table";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { rpc, supabase, toAppError, unwrap } from "@/lib/supabase";

interface Member { id: string; user_id: string; email: string; display_name: string | null; role_id: string; role_name: string; outlet_ids: string[] | null; status: string; created_at: string; last_sign_in_at: string | null }
interface Role { id: string; name: string; description: string | null; system_key: string | null; permissions: string[] }
interface Perm { code: string; module: string; description: string }

function OutletChooser({ value, onChange }: { value: string[] | null; onChange: (v: string[] | null) => void }) {
  const { allOutlets } = useOrg();
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={value === null} onChange={(e) => onChange(e.target.checked ? null : allOutlets.map((o) => o.id))} /> All outlets, including future ones</label>
      {value !== null && allOutlets.map((o) => (
        <label key={o.id} className="ms-6 flex items-center gap-2 text-sm">
          <Checkbox checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} /> {o.name}
        </label>
      ))}
    </div>
  );
}

export default function StaffPage() {
  const orgId = useOrgId();
  const { user } = useAuth();
  const { membership, allOutlets } = useOrg();
  const qc = useQueryClient();
  const [invite, setInvite] = React.useState<{ email: string; role: string; outlets: string[] | null; name: string } | null>(null);
  const [editMember, setEditMember] = React.useState<Member | null>(null);
  const [editRole, setEditRole] = React.useState<Partial<Role> | null>(null);
  const [busy, setBusy] = React.useState(false);

  const members = useQuery({ queryKey: ["members", orgId], queryFn: () => rpc<Member[]>("list_members", { p_org: orgId }) });
  const roles = useQuery({ queryKey: ["roles", orgId], queryFn: async () => unwrap(await supabase.from("roles").select("*").eq("organization_id", orgId).order("created_at")) as Role[] });
  const perms = useQuery({ queryKey: ["permissions"], queryFn: async () => unwrap(await supabase.from("permissions").select("*").order("module").order("code")) as Perm[] });
  const invites = useQuery({ queryKey: ["invitations", orgId], queryFn: async () => unwrap(await supabase.from("invitations").select("id, email, status, created_at, expires_at, roles(name)").eq("organization_id", orgId).eq("status", "pending").order("created_at", { ascending: false })) as unknown as { id: string; email: string; created_at: string; expires_at: string; roles: { name: string } }[] });
  const isOwner = membership?.system_key === "owner";
  const outletNames = (ids: string[] | null) => (ids === null ? "All outlets" : ids.map((i) => allOutlets.find((o) => o.id === i)?.name).filter(Boolean).join(", ") || "None");
  const modules = [...new Set(perms.data?.map((p) => p.module))];
  const refresh = () => ["members", "roles", "invitations", "memberships"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  return (
    <>
      <PageHeader title="Staff & roles" description="Each person signs in with their own account. Roles decide what they can do, and are enforced by the server."
        actions={<Button size="sm" onClick={() => setInvite({ email: "", role: roles.data?.find((r) => r.system_key === "cashier")?.id ?? "", outlets: null, name: "" })}><UserPlus /> Invite staff</Button>} />
      <Card>
        <Table>
          <THead><tr><Th>Person</Th><Th>Role</Th><Th>Outlets</Th><Th>Last sign-in</Th><Th>Status</Th></tr></THead>
          {members.isLoading ? <TableSkeleton cols={5} rows={3} /> : (
            <tbody>
              {members.data?.map((m) => (
                <Tr key={m.id} onClick={() => setEditMember(m)}>
                  <Td><div className="font-medium">{m.display_name ?? m.email.split("@")[0]}{m.user_id === user?.id && <span className="ms-1 text-xs text-muted">(you)</span>}</div><div className="text-xs text-muted">{m.email}</div></Td>
                  <Td>{m.role_name}</Td><Td className="text-muted">{outletNames(m.outlet_ids)}</Td>
                  <Td className="text-muted">{m.last_sign_in_at ? fmtDateTime(m.last_sign_in_at) : "Never"}</Td>
                  <Td><Badge tone={m.status === "active" ? "ok" : "neutral"} className="capitalize">{m.status}</Badge></Td>
                </Tr>
              ))}
            </tbody>
          )}
        </Table>
      </Card>

      {!!invites.data?.length && (
        <Card className="mt-4">
          <CardHeader title="Pending invitations" description="They'll see the invitation after creating an account with this email." />
          <ul className="divide-y divide-line">
            {invites.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="flex-1">{i.email} <span className="text-muted">· {i.roles.name} · expires {fmtDate(i.expires_at)}</span></span>
                <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(`${location.origin}/login`); toast.success("Sign-up link copied"); }}><Copy /> Copy sign-up link</Button>
                <Button size="sm" variant="danger-ghost" onClick={async () => {
                  const { error } = await supabase.from("invitations").update({ status: "revoked" }).eq("id", i.id);
                  if (error) return toast.error(toAppError(error).message);
                  refresh();
                }}>Revoke</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader title="Roles" description="Owner always has every permission. Other roles can be adjusted, and you can create your own."
          action={<Button size="sm" variant="secondary" onClick={() => setEditRole({ name: "", permissions: [] })}><Plus /> New role</Button>} />
        <ul className="divide-y divide-line">
          {roles.data?.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <ShieldCheck className="size-4 text-lagoon" />
              <span className="flex-1"><span className="font-medium">{r.name}</span><span className="block text-xs text-muted">{r.system_key === "owner" ? "Full access" : `${r.permissions.length} permissions`}{r.description ? ` · ${r.description}` : ""}</span></span>
              {r.system_key !== "owner" && <Button size="sm" variant="ghost" onClick={() => setEditRole(r)}>Edit</Button>}
            </li>
          ))}
        </ul>
      </Card>

      <Dialog open={!!invite} onOpenChange={(o) => !o && setInvite(null)}>
        <DialogContent title="Invite a staff member" description="No email is sent automatically. Share the sign-up link; the invitation appears once they sign up with this exact email.">
          {invite && (
            <div className="space-y-3">
              <Field label="Email" htmlFor="inv-email"><Input id="inv-email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} autoFocus /></Field>
              <Field label="Name on receipts" htmlFor="inv-name"><Input id="inv-name" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} /></Field>
              <Field label="Role" htmlFor="inv-role"><Select id="inv-role" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                {roles.data?.filter((r) => isOwner || r.system_key !== "owner").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
              <Field label="Outlets"><OutletChooser value={invite.outlets} onChange={(v) => setInvite({ ...invite, outlets: v })} /></Field>
            </div>
          )}
          <DialogFooter>
            <Button disabled={!invite || !/^\S+@\S+\.\S+$/.test(invite.email) || !invite.role} loading={busy} onClick={async () => {
              setBusy(true);
              try {
                await rpc("invite_staff", { p_org: orgId, p_email: invite!.email, p_role: invite!.role, p_outlet_ids: invite!.outlets, p_display_name: invite!.name || null });
                toast.success(`Invitation created for ${invite!.email}`);
                refresh(); setInvite(null);
              } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
            }}>Create invitation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editMember} onOpenChange={(o) => !o && setEditMember(null)}>
        <DialogContent title={editMember?.display_name ?? editMember?.email ?? ""} description={editMember?.email}>
          {editMember && (
            <div className="space-y-3">
              <Field label="Name on receipts" htmlFor="m-name"><Input id="m-name" value={editMember.display_name ?? ""} onChange={(e) => setEditMember({ ...editMember, display_name: e.target.value })} /></Field>
              <Field label="Role" htmlFor="m-role"><Select id="m-role" value={editMember.role_id} onChange={(e) => setEditMember({ ...editMember, role_id: e.target.value })}>
                {roles.data?.filter((r) => isOwner || r.system_key !== "owner").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
              <Field label="Outlets"><OutletChooser value={editMember.outlet_ids} onChange={(v) => setEditMember({ ...editMember, outlet_ids: v })} /></Field>
              <Field label="Access" htmlFor="m-status"><Select id="m-status" value={editMember.status} onChange={(e) => setEditMember({ ...editMember, status: e.target.value })}>
                <option value="active">Active</option><option value="disabled">Disabled — can't sign in to this business</option></Select></Field>
            </div>
          )}
          <DialogFooter>
            <Button loading={busy} onClick={async () => {
              setBusy(true);
              try {
                await rpc("update_member", { p_member: editMember!.id, p_role: editMember!.role_id, p_outlet_ids: editMember!.outlet_ids, p_status: editMember!.status, p_display_name: editMember!.display_name });
                toast.success("Access updated"); refresh(); setEditMember(null);
              } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editRole} onOpenChange={(o) => !o && setEditRole(null)}>
        <DialogContent title={editRole?.id ? `Edit ${editRole.name}` : "New role"} wide>
          {editRole && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" htmlFor="r-name"><Input id="r-name" value={editRole.name ?? ""} onChange={(e) => setEditRole({ ...editRole, name: e.target.value })} /></Field>
                <Field label="Description" htmlFor="r-desc"><Textarea id="r-desc" value={editRole.description ?? ""} onChange={(e) => setEditRole({ ...editRole, description: e.target.value })} className="min-h-9" /></Field>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {modules.map((m) => (
                  <fieldset key={m}>
                    <legend className="mb-1 text-sm font-semibold">{m}</legend>
                    {perms.data?.filter((p) => p.module === m).map((p) => (
                      <label key={p.code} className="flex items-start gap-2 py-0.5 text-sm">
                        <Checkbox className="mt-0.5" checked={editRole.permissions?.includes(p.code)} onChange={(e) => setEditRole({ ...editRole,
                          permissions: e.target.checked ? [...(editRole.permissions ?? []), p.code] : (editRole.permissions ?? []).filter((x) => x !== p.code) })} />
                        {p.description}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            </>
          )}
          <DialogFooter>
            {editRole?.id && !editRole.system_key && <Button variant="danger-ghost" className="me-auto" onClick={async () => {
              const { error } = await supabase.from("roles").delete().eq("id", editRole.id!);
              if (error) return toast.error("Reassign everyone with this role first.");
              refresh(); setEditRole(null);
            }}>Delete role</Button>}
            <Button disabled={!editRole?.name?.trim()} onClick={async () => {
              const row = { name: editRole!.name!.trim(), description: editRole!.description || null, permissions: editRole!.permissions ?? [] };
              const { error } = editRole!.id ? await supabase.from("roles").update(row).eq("id", editRole!.id) : await supabase.from("roles").insert({ ...row, organization_id: orgId });
              if (error) return toast.error(toAppError(error).message);
              toast.success("Role saved"); refresh(); setEditRole(null);
            }}>Save role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {members.data?.length === 0 && <EmptyState icon={Users} title="No staff yet" />}
    </>
  );
}
