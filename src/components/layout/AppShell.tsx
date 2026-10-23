import { useQuery } from "@tanstack/react-query";
import { Building2, Check, ChevronsUpDown, CloudOff, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, Sun, X } from "lucide-react";
import * as React from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { useOrg } from "@/app/org";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/misc";
import { useOnline, useSyncSummary } from "@/offline/hooks";
import { rpc } from "@/lib/supabase";
import { cn, initials } from "@/lib/utils";
import { useSession } from "@/stores/session";
import { Wordmark } from "./Logo";
import { adminNav, navGroups, type NavItem } from "./nav";

function useVisibleNav() {
  const { can } = useOrg();
  const { data: isAdmin } = useQuery({ queryKey: ["am-admin"], queryFn: () => rpc<boolean>("am_platform_admin"), staleTime: 300_000 });
  const groups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.any || i.any.some(can)) }))
    .filter((g) => g.items.length);
  return { groups, admin: isAdmin ? adminNav : null };
}

function NavLinkItem({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/inventory"}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-3 rounded-md px-2.5 py-[7px] text-[13.5px] text-reef-text transition-colors hover:bg-white/6 hover:text-white",
          isActive && "bg-white/10 font-medium text-white shadow-[inset_2px_0_0_var(--lagoon)]",
          collapsed && "justify-center px-0",
        )
      }>
      <Icon className="size-[18px] shrink-0 opacity-90" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
}

function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { groups, admin } = useVisibleNav();
  return (
    <nav className="flex h-full flex-col bg-reef text-reef-text" aria-label="Main">
      <div className={cn("flex h-14 items-center px-4 text-white", collapsed && "justify-center px-0")}>
        <Wordmark compact={collapsed} />
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-2.5 pb-4 pt-2">
        {groups.map((g) => (
          <div key={g.label}>
            {!collapsed && <div className="mb-1 px-2.5 text-[11px] font-medium text-reef-text/55">{g.label}</div>}
            <div className="space-y-0.5">
              {g.items.map((i) => (
                <NavLinkItem key={i.to} item={i} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
        {admin && (
          <div className="border-t border-white/10 pt-3">
            <NavLinkItem item={admin} collapsed={collapsed} onNavigate={onNavigate} />
          </div>
        )}
      </div>
    </nav>
  );
}

function ConnectionBadge() {
  const online = useOnline();
  const sync = useSyncSummary();
  const navigate = useNavigate();
  if (online && sync.pending === 0 && sync.failed === 0) return null;
  return (
    <button onClick={() => navigate("/pos?sync=1")} className="flex items-center gap-1.5">
      {!online && (
        <Badge tone="saffron">
          <CloudOff className="size-3.5" /> Offline
        </Badge>
      )}
      {sync.pending > 0 && (
        <Badge tone="lagoon">
          <RefreshCw className="size-3.5" /> {sync.pending} to sync
        </Badge>
      )}
      {sync.failed > 0 && <Badge tone="coral">{sync.failed} need attention</Badge>}
    </button>
  );
}

function OrgMenu() {
  const { user, signOut } = useAuth();
  const { memberships, membership } = useOrg();
  const { setOrg, theme, setTheme } = useSession();
  const navigate = useNavigate();
  const dark = theme === "dark" || (theme === "system" && document.documentElement.classList.contains("dark"));
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-fg/5" aria-label="Account menu">
          <span className="grid size-8 place-items-center rounded-full bg-lagoon-soft text-xs font-semibold text-lagoon-strong">
            {initials(user?.email)}
          </span>
          <span className="hidden max-w-40 text-start leading-tight md:block">
            <span className="block truncate text-[13px] font-medium">{membership?.organization_name}</span>
            <span className="block truncate text-xs text-muted">{membership?.role_name}</span>
          </span>
          <ChevronsUpDown className="hidden size-4 text-subtle md:block" />
        </button>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-64">
        <DropdownLabel>{user?.email}</DropdownLabel>
        <DropdownSeparator />
        {memberships.map((m) => (
          <DropdownItem key={m.organization_id} onSelect={() => setOrg(m.organization_id)}>
            <Building2 />
            <span className="flex-1 truncate">{m.organization_name}</span>
            {m.organization_id === membership?.organization_id && <Check className="!text-lagoon" />}
          </DropdownItem>
        ))}
        <DropdownItem onSelect={() => navigate("/onboarding")}>
          <span className="ms-6">Create another business</span>
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem onSelect={() => setTheme(dark ? "light" : "dark")}>
          {dark ? <Sun /> : <Moon />} {dark ? "Light mode" : "Dark mode"}
        </DropdownItem>
        <DropdownItem onSelect={() => signOut().then(() => navigate("/login"))}>
          <LogOut /> Sign out
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

function OutletPicker() {
  const { outlets, outlet } = useOrg();
  const setOutlet = useSession((s) => s.setOutlet);
  if (outlets.length <= 1) return outlet ? <span className="hidden text-[13px] text-muted sm:inline">{outlet.name}</span> : null;
  return (
    <Select aria-label="Outlet" value={outlet?.id ?? ""} onChange={(e) => setOutlet(e.target.value)} className="h-8 w-44">
      {outlets.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </Select>
  );
}

export function AppShell() {
  const { sidebarCollapsed, toggleSidebar } = useSession();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const location = useLocation();
  const fullBleed = location.pathname.startsWith("/pos");
  const collapsed = sidebarCollapsed || fullBleed; // the register gets the full width

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className={cn("hidden shrink-0 transition-[width] duration-200 lg:block", collapsed ? "w-[64px]" : "w-[232px]")}>
        <Sidebar collapsed={collapsed} />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-reef/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 start-0 w-[260px]">
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
            <button className="absolute end-2 top-3 rounded p-1 text-white/80" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <Button variant="ghost" size="icon-sm" className={cn("hidden", !fullBleed && "lg:inline-flex")} onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
          <OutletPicker />
          <div className="ms-auto flex items-center gap-2">
            <ConnectionBadge />
            <OrgMenu />
          </div>
        </header>
        <main className={cn("min-h-0 flex-1 overflow-y-auto", !fullBleed && "px-4 py-5 sm:px-6 lg:px-8")}>
          <div className={cn(!fullBleed && "mx-auto max-w-[1400px]", fullBleed && "h-full")}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
