# Chopdesk

Restaurant management SaaS: shifts, stock, orders, expenses and shift reports for restaurants, built on Next.js and Supabase.

## Develop

    npm install
    npm run dev

Create `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for your Supabase project.

## Database

All schema changes live in `supabase/migrations`, applied in order.