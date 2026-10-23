import { BarChart3, Boxes, Landmark, Receipt, Truck, Vault, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { useOrg } from "@/app/org";
import { Card, PageHeader } from "@/components/ui/misc";

export default function ReportsPage() {
  const { can } = useOrg();
  const cards = [
    { to: "/reports/sales", icon: BarChart3, title: "Sales", body: "Net sales, profit, refunds and trends by hour, day or month; breakdowns by product, category, cashier, outlet and payment.", show: can("reports.view") },
    { to: "/reports/inventory", icon: Boxes, title: "Inventory", body: "Stock valuation at weighted-average cost, slow movers, ageing and shrinkage.", show: can("inventory.view") },
    { to: "/reports/tax", icon: Landmark, title: "GST summary", body: "Taxable value and output tax by rate for a filing period, net of refunds.", show: can("reports.financial") },
    { to: "/shifts", icon: Vault, title: "Shift closeouts", body: "Expected vs counted cash and variances for every shift.", show: can("reports.view") || can("shifts.approve") },
    { to: "/customers?balance=1", icon: Wallet, title: "Receivables", body: "Customer balances and statements. Ageing is on the sales report.", show: can("customers.view") },
    { to: "/purchases", icon: Truck, title: "Purchasing", body: "Supplier purchase totals are on the inventory report.", show: can("purchases.view") },
    { to: "/sales", icon: Receipt, title: "Sales history", body: "Every invoice with search and export.", show: can("sales.view") },
  ].filter((c) => c.show);
  return (
    <>
      <PageHeader title="Reports" description="All figures are calculated from recorded transactions. Dates use Maldives time." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.to} to={c.to}>
            <Card className="h-full p-5 transition-colors hover:border-lagoon/60">
              <c.icon className="size-5 text-lagoon" />
              <h2 className="mt-3 font-display text-base font-semibold">{c.title}</h2>
              <p className="mt-1 text-sm text-muted">{c.body}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
