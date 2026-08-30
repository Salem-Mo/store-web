# Supabase setup

1. Copy `.env.example` to `.env.local` for local development.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel Environment Variables.
3. If server-side worker administration is used, set `SUPABASE_SERVICE_ROLE_KEY` **only** in Vercel/server environment variables. Never put it in frontend code, `.env` committed to Git, or the browser.
4. Run `supabase-schema.sql` in Supabase SQL Editor before using the database.
5. Keep Row Level Security enabled and review policies before production use.
