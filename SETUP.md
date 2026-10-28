# Your Mates Trade Shop: go-live guide

This takes about 1–2 hours, and every service on this list is free at your volumes. Work through the steps in order. Each step tells you what to copy for later. Keep the values in a password manager, never in an email or chat.

| What | Why | Cost |
|---|---|---|
| GitHub | Stores the code. Netlify deploys from it | Free |
| Supabase | Logins, customers, prices, SKUs, orders | Free tier |
| Resend | Sends sign-up, order and invoice emails from @yourmatesbrewing.com | Free up to 3,000 emails/month |
| SumUp | Card payments, using your existing merchant account | Your normal SumUp online rate |
| Netlify | Hosts the site | Free tier |
| GoDaddy | Points trade.yourmatesbrewing.com at Netlify and verifies email sending | Already paid |

> **Why trade.yourmatesbrewing.com and not /tradeshop?** yourmatesbrewing.com runs on Shopify, and Shopify can't hand a path like /tradeshop to another site. Step 9 adds a "Trade shop" link and a /tradeshop redirect on Shopify, so people can still find it from the main site.

---

## 1. GitHub: put the code online

1. Go to github.com → **New repository**. Name it `yourmates-tradeshop` and set it to **Private**. Leave the "Add a README" box unticked.
2. On the empty repository page, click **uploading an existing file**.
3. Unzip `yourmates-tradeshop.zip` on your computer. Open the folder and drag **everything inside it** onto the GitHub page: `public`, `netlify`, `scripts`, `supabase`, `netlify.toml`, and the rest. Then click **Commit changes**.

Alternatively, connect GitHub to Claude (claude.ai → Settings → Connectors → GitHub) and tell Claude the repository name, and the code can be pushed for you.

## 2. Supabase: the database and logins

1. Go to supabase.com → **Start your project**. Sign in with GitHub.
2. Click **New project**. Name it `yourmates-tradeshop` and choose region **Sydney (ap-southeast-2)**. Make up a strong database password and keep it safe.
3. When the project is ready, open **SQL Editor** → **New query**. Paste the whole of `supabase/schema.sql` and click **Run**. You should see "Success". This creates the tables and security rules and loads the core range.
4. Open **Project Settings → API keys** (it may say "API" or "Data API") and copy:
   - **Project URL**, for example `https://abcdxyz.supabase.co` → this is `SUPABASE_URL`
   - **Publishable key** (or **anon public** key) → `SUPABASE_ANON_KEY`. This key is safe to be public.
   - **Secret key** (or **service_role** key) → `SUPABASE_SERVICE_ROLE_KEY`. This one is secret. It only ever goes into Netlify.

## 3. Resend: emails from @yourmatesbrewing.com

1. Sign up at resend.com using sales@yourmatesbrewing.com.
2. Go to **Domains → Add domain** and enter `yourmatesbrewing.com`. Resend shows 3–4 DNS records (TXT and MX). Leave that page open.
3. In another tab, open GoDaddy → **My Products → yourmatesbrewing.com → DNS → Add new record**, and add each record exactly as Resend shows it. These records sit on a `send` / `resend._domainkey` sub-name, so they **don't touch your existing email**.
4. Back in Resend, click **Verify**. This can take from a few minutes to an hour.
5. Go to **API Keys → Create API key** with "Sending access" → `RESEND_API_KEY` (secret).
6. In **Supabase → Authentication → Emails → SMTP Settings**, turn on custom SMTP and enter:
   - Host `smtp.resend.com` · Port `465` · Username `resend` · Password: your Resend API key
   - Sender email `trade@yourmatesbrewing.com` · Sender name `Your Mates Trade`

   Without this, Supabase only sends a handful of sign-up emails per hour.

## 4. SumUp: online card payments

1. Log in to me.sumup.com.
2. Find **Developers / API keys**. The menu is usually under Settings or Profile. Create a new **secret API key** with the payments scope → `SUMUP_API_KEY` (secret).
3. Copy your **merchant code**. It's shown on your profile and looks like `MXXXXXXX` → `SUMUP_MERCHANT_CODE`.
4. If you can't create a key, or online payments aren't switched on for your account, contact SumUp support and ask for "online payments / the Payment Widget via API" to be enabled on your merchant account.

## 5. Netlify: host the site

1. Go to netlify.com → sign up with GitHub → **Add new site → Import an existing project → GitHub** and pick `yourmates-tradeshop`.
2. Leave the build settings as they are, because `netlify.toml` already sets them. Before you deploy, open **Add environment variables** (or after deploying: **Site configuration → Environment variables**) and add:

| Key | Value |
|---|---|
| `SUPABASE_URL` | from step 2 |
| `SUPABASE_ANON_KEY` | from step 2 (publishable / anon) |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 2 (secret / service_role). Tick **"Contains secret values"** |
| `SUMUP_API_KEY` | from step 4. Secret |
| `SUMUP_MERCHANT_CODE` | from step 4 |
| `RESEND_API_KEY` | from step 3. Secret |
| `MAIL_FROM` | `Your Mates Trade <trade@yourmatesbrewing.com>` |
| `SALES_EMAIL` | `sales@yourmatesbrewing.com` |
| `SITE_URL` | `https://trade.yourmatesbrewing.com` |
| `NOTIFY_SECRET` | any long random string you make up, 30+ characters. You'll use it again in step 7 |
| `BUSINESS_ABN` | Your Mates Brewing Company's ABN. It's printed on customers' tax invoices |

3. Click **Deploy**. When it finishes you'll have a temporary address like `yourmates-tradeshop.netlify.app`.

## 6. GoDaddy: trade.yourmatesbrewing.com

1. In Netlify, open **Domain management → Add a domain** and enter `trade.yourmatesbrewing.com`. Netlify will say it's managed elsewhere. That's expected.
2. In GoDaddy DNS, **Add new record**: Type `CNAME`, Name `trade`, Value `yourmates-tradeshop.netlify.app` (your Netlify address), TTL 1 hour.
3. Back in Netlify, wait for it to verify, then click **Provision certificate** under HTTPS if it hasn't happened automatically. This takes from a few minutes up to an hour.

## 7. Finish the Supabase settings

1. Open **Authentication → URL Configuration**:
   - Site URL: `https://trade.yourmatesbrewing.com`
   - Redirect URLs: add `https://trade.yourmatesbrewing.com/**`
2. Open **Authentication → Sign In / Providers → Email** and make sure **Confirm email** is on. New customers then have to click a link in their inbox before they can order.
3. Optional: under **Authentication → Emails → Templates**, change the "Confirm signup" subject to "Confirm your Your Mates trade account".
4. Turn on new-account emails to sales@. In the **SQL Editor**, run the following, using the same secret you put in Netlify:

```sql
insert into app_config (key, value) values
  ('notify_url',    'https://trade.yourmatesbrewing.com/api/new-account'),
  ('notify_secret', 'PASTE-THE-SAME-NOTIFY_SECRET-HERE');
```

## 8. Make yourself an admin

1. Go to https://trade.yourmatesbrewing.com and create an account with your own email. Confirm it from your inbox.
2. In the Supabase **SQL Editor**, run:

```sql
update profiles set is_admin = true, org_name = 'Your Mates Brewing'
where email = 'christen@yourmatesbrewing.com';
```

3. Open https://trade.yourmatesbrewing.com/admin.html. You'll see Orders, Master SKU list, Customers & prices, and Delivery & fees. Add more staff the same way.

## 9. Link it from the main website (Shopify)

- **Menu link:** Shopify admin → **Content → Menus** → Main menu → Add item "Trade shop" → link `https://trade.yourmatesbrewing.com`.
- **/tradeshop redirect:** Shopify admin → **Content → Menus → URL Redirects → Create URL redirect**, from `/tradeshop` to `https://trade.yourmatesbrewing.com`. If Shopify won't accept an outside address there, create a page called "Trade shop" with a button linking to the shop instead.

## 10. Test before telling customers

1. As a customer, create a test account with a second email address and place a small real order on your own card. Use pickup and delivery once each.
2. Check that:
   - sales@ received a **New trade account** email and a **Trade order** email
   - the customer received an **order confirmation / tax invoice**
   - the order shows in **admin → Orders** as "Paid · to pack"
3. Refund the test payment in your SumUp dashboard, then cancel the order in admin.
4. In admin → **Delivery & fees**, set your delivery fee, free-delivery threshold, delivery days, pickup times, daily cut-off and any card surcharge.

## Before you go live

- **Liquor licence:** confirm your licence conditions cover online sales and home or venue delivery. The shop already makes customers tick an 18+ declaration and asks for ID on handover. If unattended delivery isn't allowed under your licence, tell Claude and the "Leave it in a safe spot" option will be removed.
- **Prices:** customers get 15% off the shop price set in **Master SKU list**. When you change a webshop price in Shopify, change it here too.
- **Suspicious sign-ups:** anyone can register and get 15% off. Each sign-up emails sales@. Use **Customers → Put on hold** for anyone who isn't a genuine trade customer.

## Day to day

- **New order:** you get an email, and it appears under **Orders → To pack**. Click **Mark packed**, then **Mark complete** once it's collected or delivered.
- **Low stock:** in **Master SKU list**, set a **Max per order** or untick **On sale**.
- **New beer:** add it at the bottom of **Master SKU list**. For the image URL, copy the product's image address from Shopify (right-click the image → Copy image address).
- **Different deal for a club:** in **Customers & prices**, click 15/20/25% off, or type a price for a single product.
- **Refunds:** do them in the SumUp dashboard, then click **Cancel** on the order in admin.
- **"Needs review" (red banner in Orders):** money came through, but something didn't line up. For example, the customer paid on an old card form after starting a new order. You get a "CHECK" email. Either click **Fulfil it** to treat it as a normal paid order, or refund it in SumUp and click **Cancel**.
- **Order cut-off:** by default, orders placed after 3pm can't book the next day. Change this in **Delivery & fees → Daily cut-off**.
