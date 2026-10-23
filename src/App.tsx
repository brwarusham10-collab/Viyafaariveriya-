import * as React from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./app/auth";
import { OrgProvider, useOrg } from "./app/org";
import { AppShell } from "./components/layout/AppShell";
import { Lock } from "lucide-react";
import { EmptyState, Spinner } from "./components/ui/misc";
import { supabaseConfigured } from "./lib/supabase";
import { ConfigMissing } from "./pages/ConfigMissing";
import { LoginPage } from "./pages/auth/LoginPage";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage";
import { PwaPrompt } from "./components/layout/PwaPrompt";

const OnboardingPage = React.lazy(() => import("./pages/onboarding/OnboardingPage"));
const DashboardPage = React.lazy(() => import("./pages/dashboard/DashboardPage"));
const PosPage = React.lazy(() => import("./pages/pos/PosPage"));
const SalesPage = React.lazy(() => import("./pages/sales/SalesPage"));
const SaleDetailPage = React.lazy(() => import("./pages/sales/SaleDetailPage"));
const QuotationsPage = React.lazy(() => import("./pages/sales/QuotationsPage"));
const ProductsPage = React.lazy(() => import("./pages/products/ProductsPage"));
const ProductFormPage = React.lazy(() => import("./pages/products/ProductFormPage"));
const InventoryPage = React.lazy(() => import("./pages/inventory/InventoryPage"));
const MovementsPage = React.lazy(() => import("./pages/inventory/MovementsPage"));
const TransfersPage = React.lazy(() => import("./pages/inventory/TransfersPage"));
const PurchasesPage = React.lazy(() => import("./pages/purchases/PurchasesPage"));
const PurchaseOrderPage = React.lazy(() => import("./pages/purchases/PurchaseOrderPage"));
const SuppliersPage = React.lazy(() => import("./pages/purchases/SuppliersPage"));
const CustomersPage = React.lazy(() => import("./pages/customers/CustomersPage"));
const CustomerDetailPage = React.lazy(() => import("./pages/customers/CustomerDetailPage"));
const ExpensesPage = React.lazy(() => import("./pages/expenses/ExpensesPage"));
const ShiftsPage = React.lazy(() => import("./pages/shifts/ShiftsPage"));
const ShiftDetailPage = React.lazy(() => import("./pages/shifts/ShiftDetailPage"));
const ReportsPage = React.lazy(() => import("./pages/reports/ReportsPage"));
const SalesReportPage = React.lazy(() => import("./pages/reports/SalesReportPage"));
const InventoryReportPage = React.lazy(() => import("./pages/reports/InventoryReportPage"));
const TaxReportPage = React.lazy(() => import("./pages/reports/TaxReportPage"));
const StaffPage = React.lazy(() => import("./pages/staff/StaffPage"));
const OutletsPage = React.lazy(() => import("./pages/outlets/OutletsPage"));
const SettingsPage = React.lazy(() => import("./pages/settings/SettingsPage"));
const AdminPage = React.lazy(() => import("./pages/admin/AdminPage"));

function FullPageSpinner() {
  return (
    <div className="grid h-dvh place-items-center">
      <Spinner />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Signed-in users without a business go to onboarding (or accept an invitation there). */
function RequireOrg({ children }: { children: React.ReactNode }) {
  const { memberships, loading } = useOrg();
  if (loading) return <FullPageSpinner />;
  if (memberships.length === 0) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/** UI guard for a route. Authorization is enforced server-side; this just shows a clear message. */
function Gate({ any, children }: { any: string[]; children: React.ReactNode }) {
  const { can } = useOrg();
  if (any.some(can)) return <>{children}</>;
  return (
    <EmptyState icon={Lock} title="You don't have access to this page" className="min-h-[60vh]">
      Your role doesn't include this area. Ask the business owner or a manager if you need it.
    </EmptyState>
  );
}

function Home() {
  const { can } = useOrg();
  return <Navigate to={can("reports.view") || !can("pos.sell") ? "/dashboard" : "/pos"} replace />;
}

export function App() {
  if (!supabaseConfigured) return <ConfigMissing />;
  return (
    <>
      <PwaPrompt />
      <React.Suspense fallback={<FullPageSpinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/onboarding"
            element={
              <RequireAuth>
                <OrgProvider>
                  <OnboardingPage />
                </OrgProvider>
              </RequireAuth>
            }
          />
          <Route
            element={
              <RequireAuth>
                <OrgProvider>
                  <RequireOrg>
                    <AppShell />
                  </RequireOrg>
                </OrgProvider>
              </RequireAuth>
            }>
            <Route index element={<Home />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/pos" element={<Gate any={["pos.sell"]}><PosPage /></Gate>} />
            <Route path="/sales" element={<Gate any={["sales.view"]}><SalesPage /></Gate>} />
            <Route path="/sales/:id" element={<Gate any={["sales.view"]}><SaleDetailPage /></Gate>} />
            <Route path="/quotations" element={<Gate any={["pos.quotations"]}><QuotationsPage /></Gate>} />
            <Route path="/products" element={<Gate any={["products.view"]}><ProductsPage /></Gate>} />
            <Route path="/products/new" element={<Gate any={["products.manage"]}><ProductFormPage /></Gate>} />
            <Route path="/products/:id" element={<Gate any={["products.view"]}><ProductFormPage /></Gate>} />
            <Route path="/inventory" element={<Gate any={["inventory.view"]}><InventoryPage /></Gate>} />
            <Route path="/inventory/movements" element={<Gate any={["inventory.view"]}><MovementsPage /></Gate>} />
            <Route path="/inventory/transfers" element={<Gate any={["inventory.view"]}><TransfersPage /></Gate>} />
            <Route path="/purchases" element={<Gate any={["purchases.view"]}><PurchasesPage /></Gate>} />
            <Route path="/purchases/new" element={<Gate any={["purchases.manage"]}><PurchaseOrderPage /></Gate>} />
            <Route path="/purchases/:id" element={<Gate any={["purchases.view"]}><PurchaseOrderPage /></Gate>} />
            <Route path="/suppliers" element={<Gate any={["purchases.view", "suppliers.manage"]}><SuppliersPage /></Gate>} />
            <Route path="/customers" element={<Gate any={["customers.view"]}><CustomersPage /></Gate>} />
            <Route path="/customers/:id" element={<Gate any={["customers.view"]}><CustomerDetailPage /></Gate>} />
            <Route path="/expenses" element={<Gate any={["expenses.view"]}><ExpensesPage /></Gate>} />
            <Route path="/registers" element={<Navigate to="/shifts" replace />} />
            <Route path="/shifts" element={<Gate any={["shifts.manage", "shifts.approve", "reports.view"]}><ShiftsPage /></Gate>} />
            <Route path="/shifts/:id" element={<Gate any={["shifts.manage", "shifts.approve", "reports.view"]}><ShiftDetailPage /></Gate>} />
            <Route path="/reports" element={<Gate any={["reports.view", "inventory.view"]}><ReportsPage /></Gate>} />
            <Route path="/reports/sales" element={<Gate any={["reports.view"]}><SalesReportPage /></Gate>} />
            <Route path="/reports/inventory" element={<Gate any={["inventory.view"]}><InventoryReportPage /></Gate>} />
            <Route path="/reports/tax" element={<Gate any={["reports.financial"]}><TaxReportPage /></Gate>} />
            <Route path="/staff" element={<Gate any={["staff.manage"]}><StaffPage /></Gate>} />
            <Route path="/outlets" element={<Gate any={["settings.manage"]}><OutletsPage /></Gate>} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </React.Suspense>
    </>
  );
}
