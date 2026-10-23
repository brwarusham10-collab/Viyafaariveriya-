import {
  BarChart3, Boxes, ClipboardList, Contact, LayoutDashboard, Package, Receipt, ScanBarcode, Settings, Shield, Store,
  Truck, Users, Vault, Wallet, ArrowLeftRight, FileText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  any?: string[];          // visible if user has any of these permissions
}

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Sell",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/pos", label: "Register", icon: ScanBarcode, any: ["pos.sell"] },
      { to: "/sales", label: "Sales", icon: Receipt, any: ["sales.view"] },
      { to: "/quotations", label: "Quotations", icon: FileText, any: ["pos.quotations"] },
      { to: "/customers", label: "Customers", icon: Contact, any: ["customers.view"] },
    ],
  },
  {
    label: "Stock",
    items: [
      { to: "/products", label: "Products", icon: Package, any: ["products.view"] },
      { to: "/inventory", label: "Inventory", icon: Boxes, any: ["inventory.view"] },
      { to: "/inventory/transfers", label: "Transfers", icon: ArrowLeftRight, any: ["inventory.view"] },
      { to: "/purchases", label: "Purchases", icon: ClipboardList, any: ["purchases.view"] },
      { to: "/suppliers", label: "Suppliers", icon: Truck, any: ["purchases.view", "suppliers.manage"] },
    ],
  },
  {
    label: "Money",
    items: [
      { to: "/shifts", label: "Registers & shifts", icon: Vault, any: ["shifts.manage", "shifts.approve", "reports.view"] },
      { to: "/expenses", label: "Expenses", icon: Wallet, any: ["expenses.view"] },
      { to: "/reports", label: "Reports", icon: BarChart3, any: ["reports.view", "inventory.view"] },
    ],
  },
  {
    label: "Business",
    items: [
      { to: "/staff", label: "Staff & roles", icon: Users, any: ["staff.manage"] },
      { to: "/outlets", label: "Outlets", icon: Store, any: ["settings.manage"] },
      { to: "/settings", label: "Settings", icon: Settings, any: ["settings.manage", "audit.view"] },
    ],
  },
];

export const adminNav: NavItem = { to: "/admin", label: "Platform admin", icon: Shield };
