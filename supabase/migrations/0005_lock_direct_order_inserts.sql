-- 0005: orders can only be created through place_order()
--
-- RUN THIS ONLY AFTER the new payment page is live on Vercel.
-- The old payment page inserts into orders directly and stops working the
-- moment this runs.

revoke insert on public.orders from authenticated;
drop policy if exists "members take orders" on public.orders;
