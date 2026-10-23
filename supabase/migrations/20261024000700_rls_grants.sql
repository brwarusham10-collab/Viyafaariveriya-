-- VIYAFAARIVERIYAA · 0007 Row Level Security, privileges and write guards
--
-- Model:
--  * Every tenant table has RLS enabled. Reads require membership (and usually a permission).
--  * Direct writes are allowed only for master data, gated by permission, and only on whitelisted columns.
--  * Financial and stock tables (sales, payments, refunds, movements, balances, ledgers, shifts...) have
--    no client write privileges at all: they change only inside SECURITY DEFINER RPCs.

-- ---------------------------------------------------------------------------
-- Extra write guards
-- ---------------------------------------------------------------------------
create or replace function private.guard_credit_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.credit_limit > 0) or (tg_op = 'UPDATE' and new.credit_limit is distinct from old.credit_limit) then
    if auth.uid() is not null and not (private.has_perm(new.organization_id, 'pos.credit_sale')
                                       or private.has_perm(new.organization_id, 'settings.manage')) then
      raise exception 'PERMISSION_DENIED: credit limit' using errcode = '42501';
    end if;
    if auth.uid() is not null then
      perform private.audit(new.organization_id, 'customer.credit_limit', 'customer', new.id,
        jsonb_build_object('from', case when tg_op = 'UPDATE' then old.credit_limit end, 'to', new.credit_limit));
    end if;
  end if;
  return new;
end $$;
create trigger customers_credit_limit before insert or update on public.customers
  for each row execute function private.guard_credit_limit();

create or replace function private.audit_price_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and (new.retail_price, new.wholesale_price) is distinct from (old.retail_price, old.wholesale_price) then
    perform private.audit(new.organization_id, 'product.price_changed', 'product_variant', new.id,
      jsonb_build_object('retail_from', old.retail_price, 'retail_to', new.retail_price,
                         'wholesale_from', old.wholesale_price, 'wholesale_to', new.wholesale_price));
  end if;
  return new;
end $$;
create trigger product_variants_price_audit after update on public.product_variants
  for each row execute function private.audit_price_change();

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid), private.has_perm(uuid, text), private.can_access_outlet(uuid, uuid),
                          private.is_platform_admin(), private.allowed_outlets(uuid), private.member_role(uuid)
  to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- Whitelisted direct writes (column-level where it matters)
grant update (name, legal_name, tin, gst_registration, business_registration, phone, email, address, island, atoll,
              logo_path, prices_include_tax, allow_negative_stock, receipt_footer, receipt_header, locale, timezone)
  on public.organizations to authenticated;
grant insert (organization_id, name, description, permissions), update (name, description, permissions), delete
  on public.roles to authenticated;
grant update (name, address, island, phone, is_active) on public.outlets to authenticated;
grant insert (organization_id, outlet_id, name, is_active), update (name, is_active) on public.warehouses to authenticated;
grant insert (organization_id, outlet_id, name, receipt_width, is_active), update (name, receipt_width, is_active)
  on public.registers to authenticated;
grant insert (organization_id, name, rate, is_default, is_active), update (name, rate, is_default, is_active)
  on public.tax_rates to authenticated;
grant insert (organization_id, name, kind, requires_reference, requires_verification, allowed_offline, is_active, sort_order),
      update (name, requires_reference, requires_verification, allowed_offline, is_active, sort_order)
  on public.payment_methods to authenticated;
grant update (prefix, padding, next_number) on public.document_sequences to authenticated;
grant insert, update, delete on public.categories, public.brands, public.units to authenticated;
grant insert (organization_id, name, description, category_id, brand_id, unit_id, tax_rate_id, product_type, track_stock,
              sold_by_weight, is_favorite, is_active, image_path),
      update (name, description, category_id, brand_id, unit_id, tax_rate_id, sold_by_weight, is_favorite, is_active, image_path),
      delete
  on public.products to authenticated;
grant insert (organization_id, product_id, name, sku, attributes, cost_price, retail_price, wholesale_price, min_stock,
              reorder_qty, is_active, sort_order),
      update (name, sku, attributes, cost_price, retail_price, wholesale_price, min_stock, reorder_qty, is_active, sort_order),
      delete
  on public.product_variants to authenticated;
grant insert, delete on public.product_barcodes to authenticated;
grant insert, update, delete on public.outlet_prices to authenticated;
grant insert, update on public.customer_groups to authenticated;
grant insert (organization_id, name, phone, email, address, island, tin, customer_group_id, credit_limit, notes, is_active),
      update (name, phone, email, address, island, tin, customer_group_id, credit_limit, notes, is_active)
  on public.customers to authenticated;
grant insert, update on public.suppliers to authenticated;
grant insert, update on public.expense_categories to authenticated;
grant insert (organization_id, outlet_id, category_id, expense_date, amount, payment_method, reference, payee, description, attachment_path),
      update (outlet_id, category_id, expense_date, amount, payment_method, reference, payee, description, attachment_path),
      delete
  on public.expenses to authenticated;
grant insert (organization_id, outlet_id, register_id, label, cart, customer_id), delete on public.held_bills to authenticated;
grant insert (id, full_name, phone, default_organization_id), update (full_name, phone, default_organization_id)
  on public.profiles to authenticated;
grant update (status) on public.invitations to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'platform_admins','system_settings','profiles','organizations','permissions','roles','outlets','warehouses','registers',
    'organization_users','invitations','tax_rates','payment_methods','document_sequences','audit_logs',
    'categories','brands','units','products','product_variants','product_barcodes','outlet_prices','customer_groups',
    'customers','suppliers','inventory_balances','inventory_movements','stock_adjustments','stock_adjustment_items',
    'shifts','cash_movements','quotations','quotation_items','held_bills','sales','sale_items','refunds','refund_items',
    'payments','customer_ledger','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items',
    'purchase_returns','purchase_return_items','stock_transfers','stock_transfer_items','expense_categories','expenses']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Platform
create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = auth.uid());
create policy system_settings_read on public.system_settings for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy profiles_own_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_own_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_own_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Organization & configuration
create policy organizations_select on public.organizations for select to authenticated using (private.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (private.has_perm(id, 'settings.manage')) with check (private.has_perm(id, 'settings.manage'));

create policy roles_select on public.roles for select to authenticated using (private.is_member(organization_id));
create policy roles_insert on public.roles for insert to authenticated
  with check (private.has_perm(organization_id, 'staff.manage') and system_key is null);
create policy roles_update on public.roles for update to authenticated
  using (private.has_perm(organization_id, 'staff.manage') and coalesce(system_key, '') <> 'owner')
  with check (private.has_perm(organization_id, 'staff.manage'));
create policy roles_delete on public.roles for delete to authenticated
  using (private.has_perm(organization_id, 'staff.manage') and system_key is null);

create policy outlets_select on public.outlets for select to authenticated using (private.is_member(organization_id));
create policy outlets_update on public.outlets for update to authenticated
  using (private.has_perm(organization_id, 'settings.manage')) with check (private.has_perm(organization_id, 'settings.manage'));

create policy warehouses_select on public.warehouses for select to authenticated using (private.is_member(organization_id));
create policy warehouses_insert on public.warehouses for insert to authenticated with check (private.has_perm(organization_id, 'settings.manage'));
create policy warehouses_update on public.warehouses for update to authenticated
  using (private.has_perm(organization_id, 'settings.manage')) with check (private.has_perm(organization_id, 'settings.manage'));

create policy registers_select on public.registers for select to authenticated using (private.is_member(organization_id));
create policy registers_insert on public.registers for insert to authenticated with check (private.has_perm(organization_id, 'settings.manage'));
create policy registers_update on public.registers for update to authenticated
  using (private.has_perm(organization_id, 'settings.manage')) with check (private.has_perm(organization_id, 'settings.manage'));

create policy members_select on public.organization_users for select to authenticated
  using (user_id = auth.uid() or private.has_perm(organization_id, 'staff.manage'));
create policy invitations_select on public.invitations for select to authenticated
  using (private.has_perm(organization_id, 'staff.manage'));
create policy invitations_update on public.invitations for update to authenticated
  using (private.has_perm(organization_id, 'staff.manage') and status = 'pending')
  with check (status = 'revoked');

create policy tax_rates_select on public.tax_rates for select to authenticated using (private.is_member(organization_id));
create policy tax_rates_insert on public.tax_rates for insert to authenticated with check (private.has_perm(organization_id, 'settings.manage'));
create policy tax_rates_update on public.tax_rates for update to authenticated
  using (private.has_perm(organization_id, 'settings.manage')) with check (private.has_perm(organization_id, 'settings.manage'));

create policy payment_methods_select on public.payment_methods for select to authenticated using (private.is_member(organization_id));
create policy payment_methods_insert on public.payment_methods for insert to authenticated with check (private.has_perm(organization_id, 'settings.manage'));
create policy payment_methods_update on public.payment_methods for update to authenticated
  using (private.has_perm(organization_id, 'settings.manage')) with check (private.has_perm(organization_id, 'settings.manage'));

create policy sequences_select on public.document_sequences for select to authenticated using (private.is_member(organization_id));
create policy sequences_update on public.document_sequences for update to authenticated
  using (private.has_perm(organization_id, 'settings.manage')) with check (private.has_perm(organization_id, 'settings.manage'));

create policy audit_select on public.audit_logs for select to authenticated using (private.has_perm(organization_id, 'audit.view'));

-- Catalog (members read; products.manage writes)
do $$
declare t text;
begin
  foreach t in array array['categories','brands','units','products','product_variants','product_barcodes','outlet_prices'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.is_member(organization_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.has_perm(organization_id, ''products.manage''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.has_perm(organization_id, ''products.manage'')) with check (private.has_perm(organization_id, ''products.manage''))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.has_perm(organization_id, ''products.manage''))', t || '_delete', t);
  end loop;
end $$;

-- Customers (PII limited to customers.view)
create policy customer_groups_select on public.customer_groups for select to authenticated using (private.is_member(organization_id));
create policy customer_groups_insert on public.customer_groups for insert to authenticated with check (private.has_perm(organization_id, 'customers.manage'));
create policy customer_groups_update on public.customer_groups for update to authenticated
  using (private.has_perm(organization_id, 'customers.manage')) with check (private.has_perm(organization_id, 'customers.manage'));
create policy customers_select on public.customers for select to authenticated using (private.has_perm(organization_id, 'customers.view'));
create policy customers_insert on public.customers for insert to authenticated with check (private.has_perm(organization_id, 'customers.manage'));
create policy customers_update on public.customers for update to authenticated
  using (private.has_perm(organization_id, 'customers.manage')) with check (private.has_perm(organization_id, 'customers.manage'));
create policy customer_ledger_select on public.customer_ledger for select to authenticated using (private.has_perm(organization_id, 'customers.view'));

-- Suppliers & purchasing
create policy suppliers_select on public.suppliers for select to authenticated
  using (private.has_perm(organization_id, 'purchases.view') or private.has_perm(organization_id, 'suppliers.manage'));
create policy suppliers_insert on public.suppliers for insert to authenticated with check (private.has_perm(organization_id, 'suppliers.manage'));
create policy suppliers_update on public.suppliers for update to authenticated
  using (private.has_perm(organization_id, 'suppliers.manage')) with check (private.has_perm(organization_id, 'suppliers.manage'));
do $$
declare t text;
begin
  foreach t in array array['purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items','purchase_returns','purchase_return_items'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.has_perm(organization_id, ''purchases.view''))', t || '_select', t);
  end loop;
  foreach t in array array['inventory_balances','inventory_movements','stock_adjustments','stock_adjustment_items','stock_transfers','stock_transfer_items'] loop
    execute format('create policy %I on public.%I for select to authenticated using (private.has_perm(organization_id, ''inventory.view''))', t || '_select', t);
  end loop;
end $$;

-- Shifts & cash
create policy shifts_select on public.shifts for select to authenticated
  using ((private.has_perm(organization_id, 'shifts.manage') or private.has_perm(organization_id, 'shifts.approve')
          or private.has_perm(organization_id, 'reports.view'))
         and private.can_access_outlet(organization_id, outlet_id));
create policy cash_movements_select on public.cash_movements for select to authenticated
  using (exists (select 1 from public.shifts s where s.id = shift_id));

-- Sales, refunds, payments
create policy sales_select on public.sales for select to authenticated
  using (private.has_perm(organization_id, 'sales.view') and private.can_access_outlet(organization_id, outlet_id));
create policy sale_items_select on public.sale_items for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));
create policy refunds_select on public.refunds for select to authenticated
  using (private.has_perm(organization_id, 'sales.view') and private.can_access_outlet(organization_id, outlet_id));
create policy refund_items_select on public.refund_items for select to authenticated
  using (exists (select 1 from public.refunds r where r.id = refund_id));
create policy payments_select on public.payments for select to authenticated
  using (private.has_perm(organization_id, 'sales.view') or private.has_perm(organization_id, 'payments.verify')
         or (customer_id is not null and sale_id is null and private.has_perm(organization_id, 'customers.view')));

-- Quotations & parked bills
create policy quotations_select on public.quotations for select to authenticated
  using ((private.has_perm(organization_id, 'pos.quotations') or private.has_perm(organization_id, 'sales.view'))
         and private.can_access_outlet(organization_id, outlet_id));
create policy quotation_items_select on public.quotation_items for select to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id));
create policy held_bills_select on public.held_bills for select to authenticated
  using (private.has_perm(organization_id, 'pos.sell') and private.can_access_outlet(organization_id, outlet_id));
create policy held_bills_insert on public.held_bills for insert to authenticated
  with check (private.has_perm(organization_id, 'pos.sell') and private.can_access_outlet(organization_id, outlet_id));
create policy held_bills_delete on public.held_bills for delete to authenticated
  using (private.has_perm(organization_id, 'pos.sell') and private.can_access_outlet(organization_id, outlet_id));

-- Expenses
create policy expense_categories_select on public.expense_categories for select to authenticated using (private.is_member(organization_id));
create policy expense_categories_insert on public.expense_categories for insert to authenticated with check (private.has_perm(organization_id, 'expenses.manage'));
create policy expense_categories_update on public.expense_categories for update to authenticated
  using (private.has_perm(organization_id, 'expenses.manage')) with check (private.has_perm(organization_id, 'expenses.manage'));
create policy expenses_select on public.expenses for select to authenticated
  using (private.has_perm(organization_id, 'expenses.view') and (outlet_id is null or private.can_access_outlet(organization_id, outlet_id)));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (private.has_perm(organization_id, 'expenses.manage') and (outlet_id is null or private.can_access_outlet(organization_id, outlet_id)));
create policy expenses_update on public.expenses for update to authenticated
  using (private.has_perm(organization_id, 'expenses.manage'))
  with check (private.has_perm(organization_id, 'expenses.manage') and (outlet_id is null or private.can_access_outlet(organization_id, outlet_id)));
create policy expenses_delete on public.expenses for delete to authenticated using (private.has_perm(organization_id, 'expenses.manage'));
