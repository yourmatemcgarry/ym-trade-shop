-- ============================================================
-- Your Mates Trade Shop — database schema
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run once on a fresh project.
-- ============================================================

create extension if not exists pg_net with schema extensions;

-- ---------- Accounts ----------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  org_name      text not null default '',
  org_type      text not null default 'Community club',
  contact_name  text not null default '',
  phone         text not null default '',
  address_line  text not null default '',
  suburb        text not null default '',
  postcode      text not null default '',
  discount_pct  numeric(5,2) not null default 15 check (discount_pct between 0 and 90), -- applied to shop price
  status        text not null default 'active' check (status in ('active','suspended')),
  is_admin      boolean not null default false,
  admin_notes   text not null default '',
  created_at    timestamptz not null default now()
);

-- ---------- Master SKU list ----------
create table public.products (
  id            text primary key,                      -- short code, e.g. 'larry'
  sku           text not null unique,
  name          text not null,
  style         text not null default '',
  abv           numeric(4,1) not null default 0,
  pack          text not null default '',              -- e.g. '16-pack cans', '30L keg'
  shop_price    numeric(10,2) not null check (shop_price > 0), -- current webshop price incl. GST
  image_url     text not null default '',
  is_keg        boolean not null default false,
  active        boolean not null default true,         -- off = hidden from every customer
  max_per_order integer check (max_per_order is null or max_per_order > 0),
  sort          integer not null default 100,
  created_at    timestamptz not null default now()
);

-- Per-customer overrides: a fixed price and/or hiding a product from that customer
create table public.customer_products (
  customer_id uuid references public.profiles(id) on delete cascade,
  product_id  text references public.products(id) on delete cascade,
  price       numeric(10,2) check (price is null or price > 0), -- null = use the customer's discount %
  hidden      boolean not null default false,
  primary key (customer_id, product_id)
);

-- ---------- Orders ----------
create table public.orders (
  id                bigint generated always as identity (start with 1001) primary key,
  customer_id       uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  status            text not null default 'pending_payment'
                    check (status in ('pending_payment','payment_failed','abandoned','paid','packed','completed','cancelled','needs_review')),
  review_reason     text not null default '',
  org_name          text not null default '',
  email             text not null default '',
  items             jsonb not null,          -- [{product_id, sku, name, pack, qty, price, line}]
  goods             numeric(10,2) not null,
  delivery_fee      numeric(10,2) not null default 0,
  card_fee          numeric(10,2) not null default 0,
  total             numeric(10,2) not null,
  gst               numeric(10,2) not null,
  fulfilment        jsonb not null,          -- method, date, slot, need_by, address, unattended...
  notes             text not null default '',
  sumup_checkout_id text,
  paid_at           timestamptz
);
create index on public.orders (customer_id, created_at desc);
create index on public.orders (status, created_at desc);
create index on public.orders (sumup_checkout_id);

-- ---------- Settings (single row) ----------
create table public.settings (
  id            int primary key default 1 check (id = 1),
  delivery_fee  numeric(10,2) not null default 20,
  free_over     numeric(10,2) not null default 400,
  card_fee_pct  numeric(5,2)  not null default 0,
  pc_from       int not null default 4550,
  pc_to         int not null default 4575,
  pickup_days   int[] not null default '{1,2,3,4,5}',     -- 0=Sun … 6=Sat
  pickup_slots  text[] not null default '{"10am–12pm","12–3pm","3–7pm"}',
  delivery_days int[] not null default '{2,4}',
  lead_days     int not null default 1,
  cutoff_hour   int not null default 15 check (cutoff_hour between 0 and 24), -- orders after this hour (Brisbane) can't book the next day
  pickup_address text not null default '41 Technology Drive, Warana QLD 4575'
);
insert into public.settings (id) values (1);

-- Private config used by the database itself (new-account notifications)
create table public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;   -- no policies: invisible to the website

-- ============================================================
-- Helper functions
-- ============================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- Price list for one customer (used by the payment function with the service key)
create or replace function public.price_list_for(p_customer uuid)
returns table (
  id text, sku text, name text, style text, abv numeric, pack text,
  image_url text, is_keg boolean, max_per_order int, sort int,
  shop_price numeric, price numeric
)
language sql stable security definer set search_path = public as $$
  select p.id, p.sku, p.name, p.style, p.abv, p.pack, p.image_url, p.is_keg,
         p.max_per_order, p.sort, p.shop_price,
         coalesce(cp.price, round(p.shop_price * (1 - pr.discount_pct / 100.0))) as price
  from products p
  join profiles pr on pr.id = p_customer and pr.status = 'active'
  left join customer_products cp on cp.customer_id = pr.id and cp.product_id = p.id
  where p.active and not coalesce(cp.hidden, false)
  order by p.is_keg, p.sort, p.name;
$$;
revoke all on function public.price_list_for(uuid) from public, anon, authenticated;
grant execute on function public.price_list_for(uuid) to service_role;

-- The signed-in customer's own price list (used by the shop page)
create or replace function public.my_price_list()
returns table (
  id text, sku text, name text, style text, abv numeric, pack text,
  image_url text, is_keg boolean, max_per_order int, sort int,
  shop_price numeric, price numeric
)
language sql stable security definer set search_path = public as $$
  select * from price_list_for(auth.uid());
$$;
revoke all on function public.my_price_list() from public, anon;
grant execute on function public.my_price_list() to authenticated;

-- Admin: preview any customer's price list
create or replace function public.admin_price_list(p_customer uuid)
returns table (
  id text, sku text, name text, style text, abv numeric, pack text,
  image_url text, is_keg boolean, max_per_order int, sort int,
  shop_price numeric, price numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query select * from price_list_for(p_customer);
end $$;
revoke all on function public.admin_price_list(uuid) from public, anon;
grant execute on function public.admin_price_list(uuid) to authenticated;

-- ============================================================
-- New sign-ups: create the profile and notify sales
-- ============================================================
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into profiles (id, email, org_name, org_type, contact_name, phone, address_line, suburb, postcode)
  values (new.id, new.email,
          coalesce(m->>'org_name',''), coalesce(nullif(m->>'org_type',''),'Community club'),
          coalesce(m->>'contact_name',''), coalesce(m->>'phone',''),
          coalesce(m->>'address_line',''), coalesce(m->>'suburb',''), coalesce(m->>'postcode',''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.notify_new_profile() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare u text; s text;
begin
  select value into u from app_config where key = 'notify_url';
  select value into s from app_config where key = 'notify_secret';
  if u is not null then
    perform net.http_post(
      url := u,
      body := jsonb_build_object('type','new_account','profile', to_jsonb(new)),
      headers := jsonb_build_object('Content-Type','application/json','x-notify-secret', coalesce(s,''))
    );
  end if;
  return new;
end $$;
create trigger on_profile_created after insert on public.profiles
  for each row execute function public.notify_new_profile();

-- Customers can edit their own contact details, but never their discount, status or admin flag
create or replace function public.protect_profile_fields() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Only restrict a signed-in, non-admin user. The payment functions (service key)
  -- and the SQL editor have no signed-in user, so they can change anything.
  if auth.uid() is not null and not is_admin() then
    new.discount_pct := old.discount_pct;
    new.status       := old.status;
    new.is_admin     := old.is_admin;
    new.admin_notes  := old.admin_notes;
    new.email        := old.email;
    new.id           := old.id;
    new.created_at   := old.created_at;
  end if;
  return new;
end $$;
create trigger protect_profile before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- Keep the receipt email in step if a customer changes their login email
create or replace function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set email = new.email where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.sync_profile_email();

-- ============================================================
-- Table privileges: explicit, rather than relying on Supabase's defaults
-- ============================================================
revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.products to authenticated;           -- RLS: admins only
grant select, insert, update, delete on public.customer_products to authenticated;  -- RLS: read own, admins write
grant select, update on public.orders to authenticated;                             -- RLS: read own, admins update
grant select, update on public.settings to authenticated;                           -- RLS: admins update
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke execute on function public.handle_new_user(), public.notify_new_profile(),
  public.protect_profile_fields(), public.sync_profile_email() from public, anon, authenticated;

-- ============================================================
-- Row level security
-- ============================================================
alter table public.profiles          enable row level security;
alter table public.products          enable row level security;
alter table public.customer_products enable row level security;
alter table public.orders            enable row level security;
alter table public.settings          enable row level security;

create policy "own profile or admin" on public.profiles for select
  using (id = auth.uid() or is_admin());
create policy "update own profile or admin" on public.profiles for update
  using (id = auth.uid() or is_admin());

create policy "admins read products" on public.products for select using (is_admin());
create policy "admins write products" on public.products for all using (is_admin()) with check (is_admin());

create policy "own overrides or admin" on public.customer_products for select
  using (customer_id = auth.uid() or is_admin());
create policy "admins write overrides" on public.customer_products for all
  using (is_admin()) with check (is_admin());

create policy "own orders or admin" on public.orders for select
  using (customer_id = auth.uid() or is_admin());
create policy "admins update orders" on public.orders for update using (is_admin());
-- Orders are only ever created by the payment function (service key), never from the browser.

create policy "signed-in read settings" on public.settings for select using (auth.role() = 'authenticated');
create policy "admins update settings" on public.settings for update using (is_admin());

-- ============================================================
-- Seed: the beer range from yourmatesbrewing.com (October 2026)
-- Prices are the current webshop prices. Core range on; everything else starts switched off
-- (turn any of them on in admin → Master SKU list).
-- ============================================================
insert into public.products (id, sku, name, style, abv, pack, shop_price, image_url, is_keg, active, sort) values
('larry',        'YMB-LARRY-16',   'Larry',                 'Pale Ale',            4.5, '16-pack cans',        65.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/2025-6-18_Beer_Tiles_Shop-online-02_1.jpg', false, true,  10),
('dave',         'YMB-DAVE-16',    'Dave',                  'Hazy Pale Ale',       4.0, '16-pack cans',        65.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/HazyDave_2x_ff49ca11-428c-40a5-a9c4-32b2a8d52f01.png', false, true,  20),
('larry-jr',     'YMB-LARJR-16',   'Larry Jr',              'Middy Pale Ale',      3.5, '16 × 355mL cans',     52.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/Larry_Jr_Middy_Pale_Ale.png', false, true,  30),
('tilly',        'YMB-TILLY-16',   'Tilly',                 'Ginger Beer',         4.0, '16 × 330mL cans',     70.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/GoodTimesTilly_2x_cb0d802e-d8ae-4d67-b7a8-77361de3beae.png', false, true,  40),
('low-sugar',    'YMB-LSGB-16',    'Low Sugar Ginger Beer', 'Ginger Beer',         4.0, '16-pack cans',        45.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/2025-6-18_Beer_Tiles_Shop-online-03_1.jpg', false, false,  50),
('lager',        'YMB-LAGER-24',   'Your Mates Lager',      'Low Carb Lager',      4.2, '24-pack cans',        65.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/2025-6-18_Beer_Tiles_Shop-online-01_1.jpg', false, true,  60),
('middy-lager',  'YMB-MIDLAG-16',  'Your Mates Middy',      'Middy Lager',         3.5, '16-pack cans',        48.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/2025-6-18_Beer_Tiles_Shop-online-05_1.jpg', false, true,  70),
('donnie',       'YMB-DONNIE-16',  'Donnie',                'Dark Ale',            5.0, '16-pack cans',        75.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/DonnieDarko.png', false, false,  80),
('sally',        'YMB-SALLY-16',   'Sally',                 'IPA',                 6.0, '16-pack cans',        75.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/2025-6-18_Beer_Tiles_Shop-online-04_1.jpg', false, false,  90),
('jeff',         'YMB-JEFF-CTN',   'Jeff',                  'Juicy IIPA',          8.0, 'Carton',              90.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/Jeff_Juicy_IIPA_Beer_WARANA_Sunshine_Coast_FRONT_e0cef6a1-eb24-4d0a-ba61-a4685bd0999b.jpg', false, false, 100),
('bluey',        'YMB-BLUEY-16',   'Bluey',                 'Red IPA',             6.0, '16 × 355mL cans',     80.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/BLUEY.png', false, false, 110),
('larry-keg',    'YMB-LARRY-K30',  'Larry',                 'Pale Ale',            4.5, '30L keg',            295.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/Larry_Keg_2x_e097e5af-358f-4b01-b70f-1965aef6db62.png', true, true, 200),
('lager-keg',    'YMB-LAGER-K30',  'Your Mates Lager',      'Low Carb Lager',      4.2, '30L keg',            295.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/Lager_Keg_2x_d1bdefeb-5ca4-4997-8e8d-0726e0377cc2.png', true, true, 210),
('tilly-keg',    'YMB-TILLY-K30',  'Tilly',                 'Ginger Beer',         4.0, '30L keg',            490.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/Tilly_Keg_2x_f8a506aa-d3b2-4352-ace6-a19353faeb6c.png', true, true, 220),
('low-sugar-k30','YMB-LSGB-K30',   'Low Sugar Ginger Beer', 'Ginger Beer',         4.0, '30L keg',            150.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/Low_suger_keg.jpg', true, false, 230),
('low-sugar-k50','YMB-LSGB-K50',   'Low Sugar Ginger Beer', 'Ginger Beer',         4.0, '50L keg',            200.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/Low_suger_keg.jpg', true, false, 240),
('wayno-keg',    'YMB-WAYNO-K50',  'Wayno',                 'Watermelon Sour',     4.5, '50L keg',            420.00, 'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/Wayno_07695e72-cc14-4855-b101-5182bbf3e815.jpg', true, false, 250);
