# Your Mates Trade Shop

Trade ordering for community groups, clubs, schools and short-stay hosts. It runs at trade.yourmatesbrewing.com.

- `public/`: the website. `index.html` is the customer shop and `admin.html` is the staff admin.
- `netlify/functions/`: server code for creating SumUp checkouts, confirming payments, the SumUp webhook and new-account emails.
- `netlify/lib/`: shared server code. Prices and totals are always recalculated here, never trusted from the browser.
- `supabase/schema.sql`: database tables, security rules and the starting product range.
- `scripts/write-config.mjs`: puts the public Supabase address into the site at build time.

See **SETUP.md** for the go-live steps. No npm packages are needed.
