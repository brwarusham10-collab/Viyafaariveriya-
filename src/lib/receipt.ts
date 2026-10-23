import { supabase, unwrap } from "./supabase";
import type { Organization, Outlet, Payment, Register, Sale, SaleItem } from "./types";

export interface ReceiptData {
  provisional?: boolean;
  title?: string;            // e.g. QUOTATION; defaults to TAX INVOICE
  org: Pick<Organization, "name" | "legal_name" | "tin" | "gst_registration" | "phone" | "address" | "island" | "receipt_header" | "receipt_footer" | "currency">;
  outlet: Pick<Outlet, "name" | "address" | "island" | "phone"> | null;
  register: Pick<Register, "name"> | null;
  sale: Pick<Sale, "invoice_number" | "sold_at" | "subtotal" | "discount_total" | "tax_total" | "total" | "change_given" | "prices_include_tax" | "status" | "payment_status" | "balance_due" | "notes">;
  items: Pick<SaleItem, "name" | "sku" | "qty" | "unit_price" | "line_discount" | "cart_discount_alloc" | "tax_rate" | "tax_amount" | "line_total">[];
  payments: Pick<Payment, "method_name" | "amount" | "tendered" | "reference" | "status" | "direction">[];
  cashier: string | null;
  customer: { name: string; phone: string | null; tin: string | null; address: string | null } | null;
}

export async function loadReceipt(saleId: string): Promise<ReceiptData> {
  const sale = unwrap(await supabase.from("sales").select("*").eq("id", saleId).single()) as Sale & { organization_id: string };
  const [org, outlet, register, items, payments, names, customer] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", sale.organization_id).single(),
    supabase.from("outlets").select("*").eq("id", sale.outlet_id).single(),
    supabase.from("registers").select("name").eq("id", sale.register_id).single(),
    supabase.from("sale_items").select("*").eq("sale_id", saleId).order("line_no"),
    supabase.from("payments").select("*").eq("sale_id", saleId).is("refund_id", null).order("created_at"),
    supabase.rpc("member_names", { p_org: sale.organization_id }),
    sale.customer_id
      ? supabase.from("customers").select("name, phone, tin, address").eq("id", sale.customer_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const cashier = ((names.data ?? []) as { user_id: string; display_name: string }[]).find((n) => n.user_id === sale.cashier_id)?.display_name ?? null;
  return {
    org: unwrap(org) as Organization,
    outlet: unwrap(outlet) as Outlet,
    register: unwrap(register) as Register,
    sale,
    items: unwrap(items) as SaleItem[],
    payments: unwrap(payments) as Payment[],
    cashier,
    customer: (customer.data as ReceiptData["customer"]) ?? null,
  };
}
