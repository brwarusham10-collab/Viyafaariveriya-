-- VIYAFAARIVERIYAA demo data — LOCAL / DEMO ENVIRONMENTS ONLY. Never run against production.
-- Creates a fictional retailer "Maafushi Mart (Demo)" with two outlets, ~30 products, suppliers,
-- customers, a received purchase order and 14 days of sales history.
--
-- Users (password for all: Demo#2026pos)
--   owner@demo.mv     Owner
--   manager@demo.mv   Manager
--   cashier@demo.mv   Cashier (Main outlet only)
--   platform@demo.mv  Platform admin (no tenant access)
--
-- Every transaction is created through the same RPCs the app uses, then (demo only) backdated.

\set ON_ERROR_STOP on
begin;

do $seed$
declare
  pw text := crypt('Demo#2026pos', gen_salt('bf'));
  u_owner uuid; u_manager uuid; u_cashier uuid; u_platform uuid;
  v_org uuid; v_main uuid; v_hlm uuid; v_wh_main uuid; v_wh_hlm uuid; v_wh_store uuid; v_reg uuid; v_reg2 uuid;
  c_groc uuid; c_bev uuid; c_house uuid; c_care uuid; c_fresh uuid; c_tour uuid; c_gen uuid;
  u_kg uuid; t_zero uuid;
  m_cash uuid; m_card uuid; m_bank uuid; m_acct uuid;
  s_sto uuid; s_island uuid;
  cust_resort uuid; cust_gh uuid; cust_a uuid; cust_m uuid; g_wholesale uuid;
  pid uuid; po uuid; shift uuid; sale jsonb;
  d int; n int; i int; k int;
  vids uuid[]; v uuid; qty numeric; pay uuid; tot numeric; ts timestamptz;
  rec record;
begin
  if exists (select 1 from auth.users where email = 'owner@demo.mv') then
    raise notice 'Demo data already present; skipping';
    return;
  end if;

  -- ---- Users -------------------------------------------------------------
  for rec in select * from (values ('owner@demo.mv'), ('manager@demo.mv'), ('cashier@demo.mv'), ('platform@demo.mv')) t(email) loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', rec.email, pw, now(), now(), now(),
            '{"provider":"email","providers":["email"]}', '{}', '', '', '', '')
    returning id into v;
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), v, v::text, jsonb_build_object('sub', v::text, 'email', rec.email, 'email_verified', true), 'email', now(), now(), now());
    case rec.email
      when 'owner@demo.mv' then u_owner := v;
      when 'manager@demo.mv' then u_manager := v;
      when 'cashier@demo.mv' then u_cashier := v;
      else u_platform := v;
    end case;
  end loop;
  insert into public.platform_admins (user_id) values (u_platform);

  -- act as the owner for everything below (RPCs authorise via auth.uid())
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  v_org := public.create_organization(jsonb_build_object(
    'name', 'Maafushi Mart (Demo)', 'legal_name', 'Maafushi Mart Pvt Ltd (demo)', 'tin', '1000000DEMO', 'gst_registration', 'GST-DEMO-0001',
    'phone', '+960 7000000', 'email', 'hello@maafushimart.example', 'island', 'Maafushi', 'atoll', 'Kaafu', 'address', 'Demo Magu',
    'display_name', 'Ibrahim (Owner)', 'prices_include_tax', true,
    'outlet', jsonb_build_object('name', 'Maafushi Main', 'code', 'MAIN', 'island', 'Maafushi', 'phone', '+960 7000001'),
    'register_name', 'Front counter',
    'taxes', jsonb_build_array(jsonb_build_object('name', 'GST (demo rate)', 'rate', 8, 'is_default', true),
                               jsonb_build_object('name', 'Zero-rated', 'rate', 0))));
  update public.organizations set receipt_footer = 'Thank you! Returns accepted within 7 days with receipt. (Demo business)' where id = v_org;

  v_hlm := public.create_outlet(v_org, 'Hulhumalé Branch', 'HLM', 'Nirolhu Magu (demo)', 'Hulhumalé', '+960 7000002', 'Till 1');
  select id, default_warehouse_id into v_main, v_wh_main from public.outlets where organization_id = v_org and code = 'MAIN';
  select default_warehouse_id into v_wh_hlm from public.outlets where id = v_hlm;
  insert into public.warehouses (organization_id, name) values (v_org, 'Thilafushi bulk store') returning id into v_wh_store;
  select id into v_reg from public.registers where outlet_id = v_main;
  select id into v_reg2 from public.registers where outlet_id = v_hlm;

  select id into m_cash from public.payment_methods where organization_id = v_org and kind = 'cash';
  select id into m_card from public.payment_methods where organization_id = v_org and kind = 'card';
  select id into m_bank from public.payment_methods where organization_id = v_org and kind = 'bank_transfer';
  select id into m_acct from public.payment_methods where organization_id = v_org and kind = 'on_account';
  update public.payment_methods set name = 'BML / MIB transfer' where id = m_bank;
  select id into u_kg from public.units where organization_id = v_org and abbreviation = 'kg';
  select id into t_zero from public.tax_rates where organization_id = v_org and rate = 0;

  insert into public.categories (organization_id, name, sort_order) values
    (v_org, 'Groceries', 1), (v_org, 'Beverages', 2), (v_org, 'Fresh produce', 3), (v_org, 'Household', 4), (v_org, 'Personal care', 5), (v_org, 'Beach & tourist', 6);
  select id into c_groc from public.categories where organization_id = v_org and name = 'Groceries';
  select id into c_bev from public.categories where organization_id = v_org and name = 'Beverages';
  select id into c_fresh from public.categories where organization_id = v_org and name = 'Fresh produce';
  select id into c_house from public.categories where organization_id = v_org and name = 'Household';
  select id into c_care from public.categories where organization_id = v_org and name = 'Personal care';
  select id into c_tour from public.categories where organization_id = v_org and name = 'Beach & tourist';
  select id into c_gen from public.categories where organization_id = v_org and name = 'General';

  -- ---- Products (name, category, retail, cost, opening stock main, min, barcode, favourite, weight, zero-rated) -----
  for rec in select * from (values
    ('Tuna chunks in oil 185g', c_groc, 18.50, 11.20, 140, 40, '8900000000011', true, false, false),
    ('Basmati rice 5kg', c_groc, 142.00, 98.00, 45, 15, '8900000000028', true, false, true),
    ('White sugar 1kg', c_groc, 21.00, 14.50, 90, 30, '8900000000035', false, false, true),
    ('Wheat flour 1kg', c_groc, 19.00, 12.80, 70, 25, '8900000000042', false, false, true),
    ('Coconut milk 400ml', c_groc, 16.25, 9.90, 120, 36, '8900000000059', true, false, false),
    ('Instant noodles, chicken', c_groc, 7.50, 4.10, 220, 60, '8900000000066', true, false, false),
    ('Black tea bags (100)', c_groc, 54.00, 36.00, 35, 10, '8900000000073', false, false, false),
    ('Full cream milk powder 400g', c_groc, 68.00, 47.50, 40, 12, '8900000000080', false, false, false),
    ('Cream biscuits 200g', c_groc, 15.00, 8.75, 95, 24, '8900000000097', false, false, false),
    ('Chilli sauce 300ml', c_groc, 24.50, 15.00, 30, 10, '8900000000103', false, false, false),
    ('Vegetable oil 1L', c_groc, 44.00, 31.00, 55, 20, '8900000000110', false, false, false),
    ('Eggs, tray of 30', c_fresh, 75.00, 58.00, 18, 8, '8900000000127', true, false, false),
    ('Red onions (kg)', c_fresh, 28.00, 17.00, 60, 15, '2100000000014', false, true, true),
    ('Potatoes (kg)', c_fresh, 22.00, 13.50, 55, 15, '2100000000021', false, true, true),
    ('Bananas (kg)', c_fresh, 35.00, 22.00, 25, 8, '2100000000038', true, true, true),
    ('Drinking water 1.5L', c_bev, 9.00, 5.20, 300, 96, '8900000000134', true, false, false),
    ('Drinking water 500ml', c_bev, 5.00, 2.70, 400, 120, '8900000000141', true, false, false),
    ('Orange soda 330ml can', c_bev, 13.00, 7.80, 180, 48, '8900000000158', false, false, false),
    ('Iced coffee 250ml', c_bev, 22.00, 13.50, 60, 24, '8900000000165', false, false, false),
    ('Dishwashing liquid 500ml', c_house, 32.00, 20.00, 40, 12, '8900000000172', false, false, false),
    ('Laundry powder 1kg', c_house, 58.00, 39.00, 35, 12, '8900000000189', false, false, false),
    ('Mosquito coils (10)', c_house, 26.00, 15.50, 50, 20, '8900000000196', false, false, false),
    ('Toothpaste 100g', c_care, 29.00, 17.40, 45, 15, '8900000000202', false, false, false),
    ('Shampoo 200ml', c_care, 64.00, 41.00, 28, 10, '8900000000219', false, false, false),
    ('Sunscreen SPF50 100ml', c_tour, 189.00, 118.00, 22, 8, '8900000000226', true, false, false),
    ('Reusable water bottle', c_tour, 120.00, 70.00, 6, 10, '8900000000233', false, false, false)
  ) t(name, cat, price, cost, stock, mins, barcode, fav, weight, zero) loop
    pid := public.create_product(jsonb_build_object('organization_id', v_org, 'name', rec.name, 'category_id', rec.cat,
      'is_favorite', rec.fav, 'sold_by_weight', rec.weight, 'unit_id', case when rec.weight then u_kg end, 'tax_rate_id', case when rec.zero then t_zero end,
      'variants', jsonb_build_array(jsonb_build_object('sku', upper(left(regexp_replace(rec.name, '[^A-Za-z]', '', 'g'), 6)) || '-' || right(rec.barcode, 3),
        'retail_price', rec.price, 'cost_price', rec.cost, 'wholesale_price', round(rec.price * 0.9, 2), 'min_stock', rec.mins,
        'barcodes', jsonb_build_array(rec.barcode),
        'opening_stock', jsonb_build_array(jsonb_build_object('warehouse_id', v_wh_main, 'qty', rec.stock, 'unit_cost', rec.cost),
                                           jsonb_build_object('warehouse_id', v_wh_hlm, 'qty', round(rec.stock / 3), 'unit_cost', rec.cost))))));
  end loop;

  -- variant products
  pid := public.create_product(jsonb_build_object('organization_id', v_org, 'name', 'T-shirt, island print', 'category_id', c_tour,
    'variants', (select jsonb_agg(jsonb_build_object('name', s, 'sku', 'TS-ISL-' || s, 'attributes', jsonb_build_object('Size', s), 'retail_price', 165, 'cost_price', 72,
       'min_stock', 3, 'opening_stock', jsonb_build_array(jsonb_build_object('warehouse_id', v_wh_main, 'qty', q, 'unit_cost', 72)))) from (values ('S', 8), ('M', 14), ('L', 12), ('XL', 5)) x(s, q))));
  pid := public.create_product(jsonb_build_object('organization_id', v_org, 'name', 'Snorkel mask', 'category_id', c_tour, 'is_favorite', true,
    'variants', (select jsonb_agg(jsonb_build_object('name', s, 'sku', 'SNK-' || s, 'attributes', jsonb_build_object('Size', s), 'retail_price', 275, 'cost_price', 140,
       'min_stock', 2, 'barcodes', jsonb_build_array('89100000' || b), 'opening_stock', jsonb_build_array(jsonb_build_object('warehouse_id', v_wh_main, 'qty', q, 'unit_cost', 140)))) from (values ('Kids', 4, '0001'), ('Adult', 9, '0002')) x(s, q, b))));
  pid := public.create_product(jsonb_build_object('organization_id', v_org, 'name', 'Gift wrapping', 'category_id', c_gen, 'product_type', 'service',
    'variants', jsonb_build_array(jsonb_build_object('retail_price', 15, 'sku', 'SVC-WRAP'))));

  -- bulk stock in the warehouse
  perform public.adjust_stock(jsonb_build_object('organization_id', v_org, 'client_uuid', gen_random_uuid(), 'warehouse_id', v_wh_store, 'reason_code', 'opening',
    'items', (select jsonb_agg(jsonb_build_object('variant_id', pv.id, 'qty_change', 200, 'unit_cost', pv.cost_price))
                from public.product_variants pv join public.products p on p.id = pv.product_id
               where pv.organization_id = v_org and p.category_id in (c_groc, c_bev) )));

  -- ---- Suppliers, customers ------------------------------------------------
  insert into public.suppliers (organization_id, name, contact_name, phone, payment_terms_days) values
    (v_org, 'Male'' Wholesale Traders (demo)', 'Hassan', '+960 7100001', 30) returning id into s_sto;
  insert into public.suppliers (organization_id, name, contact_name, phone, payment_terms_days) values
    (v_org, 'Island Fresh Imports (demo)', 'Shifa', '+960 7100002', 0) returning id into s_island;

  select id into g_wholesale from public.customer_groups where organization_id = v_org and name = 'Wholesale';
  insert into public.customers (organization_id, name, phone, customer_group_id, credit_limit, tin)
    values (v_org, 'Kuda Resort Supplies (demo)', '+960 7200001', g_wholesale, 20000, '1000999DEMO') returning id into cust_resort;
  insert into public.customers (organization_id, name, phone, credit_limit) values (v_org, 'Sunset Guesthouse (demo)', '+960 7200002', 5000) returning id into cust_gh;
  insert into public.customers (organization_id, name, phone) values (v_org, 'Aishath R. (demo)', '+960 7200003') returning id into cust_a;
  insert into public.customers (organization_id, name, phone) values (v_org, 'Mohamed A. (demo)', '+960 7200004') returning id into cust_m;

  -- ---- Staff ----------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  v := public.invite_staff(v_org, 'manager@demo.mv', (select id from public.roles where organization_id = v_org and system_key = 'admin'), null, 'Aminath (Manager)');
  perform set_config('request.jwt.claims', json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  perform public.accept_invitation(v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  v := public.invite_staff(v_org, 'cashier@demo.mv', (select id from public.roles where organization_id = v_org and system_key = 'cashier'), array[v_main], 'Ali (Cashier)');
  perform set_config('request.jwt.claims', json_build_object('sub', u_cashier, 'role', 'authenticated')::text, true);
  perform public.accept_invitation(v);
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  -- ---- A purchase order received with freight and duty ---------------------
  po := public.save_purchase_order(jsonb_build_object('organization_id', v_org, 'supplier_id', s_sto, 'warehouse_id', v_wh_main,
    'items', (select jsonb_agg(jsonb_build_object('variant_id', pv.id, 'qty_ordered', 48, 'unit_cost', pv.cost_price))
                from public.product_variants pv join public.products p on p.id = pv.product_id
               where pv.organization_id = v_org and p.name in ('Tuna chunks in oil 185g', 'Coconut milk 400ml', 'Instant noodles, chicken'))));
  perform public.set_purchase_order_status(po, 'approved');
  perform public.receive_goods(jsonb_build_object('organization_id', v_org, 'client_uuid', gen_random_uuid(), 'purchase_order_id', po,
    'supplier_invoice_ref', 'INV-DEMO-7781', 'freight', 120, 'duty', 85,
    'items', (select jsonb_agg(jsonb_build_object('purchase_order_item_id', id, 'variant_id', variant_id, 'qty', qty_ordered, 'unit_cost', unit_cost))
                from public.purchase_order_items where purchase_order_id = po)));
  po := public.save_purchase_order(jsonb_build_object('organization_id', v_org, 'supplier_id', s_island, 'warehouse_id', v_wh_main, 'notes', 'Weekly fresh order',
    'items', (select jsonb_agg(jsonb_build_object('variant_id', pv.id, 'qty_ordered', 30, 'unit_cost', pv.cost_price))
                from public.product_variants pv join public.products p on p.id = pv.product_id where pv.organization_id = v_org and p.category_id = c_fresh)));
  perform public.set_purchase_order_status(po, 'approved');

  -- ---- 14 days of sales ------------------------------------------------------
  select array_agg(pv.id) into vids from public.product_variants pv join public.products p on p.id = pv.product_id
   where pv.organization_id = v_org and p.track_stock and not p.sold_by_weight;

  for d in reverse 13..0 loop
    perform set_config('request.jwt.claims', json_build_object('sub', case when d % 2 = 0 then u_cashier else u_manager end, 'role', 'authenticated')::text, true);
    shift := public.open_shift(v_reg, 1000);
    n := 9 + (d * 7 % 11);
    for i in 1..n loop
      sale := jsonb_build_object('client_uuid', gen_random_uuid(), 'register_id', v_reg, 'shift_id', shift,
        'items', (select jsonb_agg(jsonb_build_object('variant_id', vids[1 + ((d * 31 + i * 17 + g.n2 * 7) % array_length(vids, 1))], 'qty', 1 + (i + g.n2) % 3))
                    from generate_series(1, 1 + (i % 4)) g(n2)));
      tot := (private.compute_cart(v_org, v_main, null, sale->'items', null, true, true)->>'total')::numeric;
      pay := case when i % 5 = 0 then m_card when i % 11 = 0 then m_bank else m_cash end;
      sale := sale || jsonb_build_object('payments', jsonb_build_array(jsonb_build_object('payment_method_id', pay,
        'amount', case when pay = m_cash then ceil(tot / 50) * 50 else tot end, 'reference', case when pay = m_bank then 'BML-' || (100000 + d * 100 + i) end)));
      begin
        perform public.pos_checkout(sale);
      exception when others then
        null; -- skip the odd basket that would oversell
      end;
    end loop;
    -- a credit sale to the resort every few days
    if d % 3 = 0 then
      perform set_config('request.jwt.claims', json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
      sale := jsonb_build_object('client_uuid', gen_random_uuid(), 'register_id', v_reg, 'shift_id', shift, 'customer_id', cust_resort,
        'items', jsonb_build_array(jsonb_build_object('variant_id', vids[2], 'qty', 6), jsonb_build_object('variant_id', vids[16], 'qty', 24)));
      tot := (private.compute_cart(v_org, v_main, cust_resort, sale->'items', null, true, true)->>'total')::numeric;
      begin
        perform public.pos_checkout(sale || jsonb_build_object('payments', jsonb_build_array(jsonb_build_object('payment_method_id', m_acct, 'amount', tot))));
      exception when others then null;
      end;
    end if;
    if d > 0 then
      perform public.add_cash_movement(shift, 'cash_out', 150, 'Ice and delivery (demo)', gen_random_uuid());
      perform public.close_shift(shift, '{"1000": 1}'::jsonb, 'Demo close');
      -- demo only: pretend the drawer was counted exactly (one day short by 20)
      perform set_config('session_replication_role', 'replica', true);
      update public.shifts set counted_cash = expected_cash, variance = case when d = 5 then -20 else 0 end,
             status = case when d > 2 then 'approved' else 'closed' end where id = shift;
      perform set_config('session_replication_role', 'origin', true);
    end if;
    -- backdate this day's records (demo only; triggers disabled for the update)
    ts := date_trunc('day', now() at time zone 'Indian/Maldives') at time zone 'Indian/Maldives' - make_interval(days => d) + interval '8 hours';
    if d > 0 then
      perform set_config('session_replication_role', 'replica', true);
      update public.shifts set opened_at = ts, closed_at = ts + interval '12 hours', approved_at = case when status = 'approved' then ts + interval '13 hours' end,
             approved_by = case when status = 'approved' then u_owner end where id = shift;
      update public.sales s set sold_at = ts + make_interval(mins => ((x.rn * 41) % 690)::int), created_at = ts + make_interval(mins => ((x.rn * 41) % 690)::int)
        from (select id, row_number() over (order by created_at) rn from public.sales where shift_id = shift) x where x.id = s.id;
      update public.payments p set created_at = s.sold_at from public.sales s where p.sale_id = s.id and s.shift_id = shift;
      update public.inventory_movements m set created_at = s.sold_at from public.sales s where m.reference_id = s.id and s.shift_id = shift;
      update public.customer_ledger l set created_at = s.sold_at from public.sales s where l.sale_id = s.id and s.shift_id = shift;
      update public.cash_movements set created_at = ts + interval '6 hours' where shift_id = shift;
      perform set_config('session_replication_role', 'origin', true);
    end if;
  end loop;

  -- a pending bank transfer is left for verification; collect part of the resort's balance
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  perform public.record_customer_payment(jsonb_build_object('organization_id', v_org, 'client_uuid', gen_random_uuid(), 'customer_id', cust_resort,
    'payment_method_id', m_bank, 'amount', 500, 'reference', 'MIB-DEMO-551'));

  -- expenses
  insert into public.expenses (organization_id, outlet_id, category_id, expense_date, amount, payment_method, payee, description, created_by)
  select v_org, v_main, ec.id, (now() at time zone 'Indian/Maldives')::date - x.days, x.amount, x.pm, x.payee, x.descr, u_owner
    from (values ('Rent', 3, 12000, 'bank_transfer', 'Landlord (demo)', 'Monthly shop rent'),
                 ('Utilities', 6, 2340.75, 'bank_transfer', 'Utility company (demo)', 'Electricity'),
                 ('Utilities', 6, 410.00, 'bank_transfer', 'Utility company (demo)', 'Water'),
                 ('Transport', 2, 350, 'cash', 'Dhoni transport (demo)', 'Stock from Male'''),
                 ('Supplies', 1, 185, 'cash', null, 'Receipt paper rolls')) x(cat, days, amount, pm, payee, descr)
    join public.expense_categories ec on ec.organization_id = v_org and ec.name = x.cat;

  -- a transfer in progress from the bulk store to Hulhumalé
  v := public.request_transfer(jsonb_build_object('organization_id', v_org, 'from_warehouse_id', v_wh_store, 'to_warehouse_id', v_wh_hlm,
     'notes', 'Weekend restock', 'items', jsonb_build_array(jsonb_build_object('variant_id', vids[16], 'qty', 48), jsonb_build_object('variant_id', vids[17], 'qty', 96))));
  perform public.advance_transfer(v, 'approve', null);

  perform set_config('request.jwt.claims', '', true);
  raise notice 'Demo business % created. Sign in as owner@demo.mv / Demo#2026pos', v_org;
end
$seed$;

commit;
