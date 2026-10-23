// Row shapes used by the UI. Numeric columns arrive from PostgREST as numbers or strings
// (numeric -> JSON number); always format through lib/money.
export type Num = number | string;

export type PaymentKind = "cash" | "card" | "bank_transfer" | "store_credit" | "on_account" | "other";

export interface Membership {
  organization_id: string;
  organization_name: string;
  organization_status: "active" | "suspended" | "closed";
  role_id: string;
  role_name: string;
  system_key: string | null;
  permissions: string[];
  outlet_ids: string[] | null;
}

export interface Organization {
  id: string;
  name: string;
  legal_name: string | null;
  tin: string | null;
  gst_registration: string | null;
  business_registration: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  island: string | null;
  atoll: string | null;
  logo_path: string | null;
  currency: string;
  timezone: string;
  prices_include_tax: boolean;
  allow_negative_stock: boolean;
  receipt_footer: string | null;
  receipt_header: string | null;
  status: string;
  plan: string;
}

export interface Outlet {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  address: string | null;
  island: string | null;
  phone: string | null;
  default_warehouse_id: string | null;
  is_active: boolean;
}

export interface Warehouse {
  id: string;
  organization_id: string;
  outlet_id: string | null;
  name: string;
  is_active: boolean;
}

export interface Register {
  id: string;
  organization_id: string;
  outlet_id: string;
  name: string;
  receipt_width: "58mm" | "80mm" | "a4";
  is_active: boolean;
}

export interface PaymentMethod {
  id: string;
  name: string;
  kind: PaymentKind;
  requires_reference: boolean;
  requires_verification: boolean;
  allowed_offline: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface TaxRate {
  id: string;
  name: string;
  rate: Num;
  is_default: boolean;
  is_active: boolean;
}

export interface CatalogItem {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_name: string;
  sku: string | null;
  category_id: string | null;
  is_favorite: boolean;
  price: number;
  wholesale_price: number | null;
  tax_rate: number;
  track_stock: boolean;
  sold_by_weight: boolean;
  allow_decimal: boolean;
  unit: string | null;
  stock: number | null;
  image_path: string | null;
  barcodes: string[];
}

export interface Category {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
}

export interface Customer {
  id: string;
  organization_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  island: string | null;
  tin: string | null;
  customer_group_id: string | null;
  credit_limit: Num;
  account_balance: Num;
  store_credit: Num;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Shift {
  id: string;
  organization_id: string;
  outlet_id: string;
  register_id: string;
  status: "open" | "closed" | "approved";
  opening_float: Num;
  opened_by: string;
  opened_at: string;
  closed_at: string | null;
  expected_cash: Num | null;
  counted_cash: Num | null;
  variance: Num | null;
}

export interface Sale {
  id: string;
  invoice_number: string;
  outlet_id: string;
  register_id: string;
  shift_id: string;
  customer_id: string | null;
  cashier_id: string;
  status: "completed" | "voided";
  payment_status: "paid" | "pending_verification" | "on_account" | "payment_rejected";
  prices_include_tax: boolean;
  subtotal: Num;
  discount_total: Num;
  tax_total: Num;
  total: Num;
  amount_paid: Num;
  balance_due: Num;
  change_given: Num;
  notes: string | null;
  is_offline: boolean;
  sold_at: string;
}

export interface SaleItem {
  id: string;
  line_no: number;
  variant_id: string;
  name: string;
  sku: string | null;
  qty: Num;
  list_price: Num;
  unit_price: Num;
  price_overridden: boolean;
  line_discount: Num;
  cart_discount_alloc: Num;
  tax_rate: Num;
  tax_amount: Num;
  line_total: Num;
  qty_refunded: Num;
  track_stock: boolean;
}

export interface Payment {
  id: string;
  method_name: string;
  method_kind: PaymentKind;
  direction: "in" | "out";
  amount: Num;
  tendered: Num | null;
  reference: string | null;
  status: "completed" | "pending" | "rejected";
  created_at: string;
  sale_id: string | null;
  customer_id: string | null;
  verification_note: string | null;
}

export interface ShiftReport {
  shift_id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  cash_in: number;
  cash_out: number;
  cash_payments_in: number;
  cash_payments_out: number;
  expected_cash: number;
  counted_cash?: number;
  variance?: number;
  denominations?: Record<string, number>;
  close_note?: string | null;
  payment_methods: { method: string; kind: string; in: number; out: number; pending: number; count: number }[];
  sales: { count: number; voided_count: number; total: number; tax: number; discounts: number; on_account: number };
  refunds: { count: number; total: number };
}
