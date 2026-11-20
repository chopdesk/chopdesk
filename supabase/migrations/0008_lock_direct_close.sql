-- 0008: shifts can only be closed through close_shift()
--
-- RUN THIS ONLY AFTER the new close page is live on Vercel and a shift has been
-- closed through it. The old close page writes to shift_close and shifts
-- directly and stops working the moment this runs.

revoke insert on public.shift_close from authenticated;
drop policy if exists "members save close counts" on public.shift_close;

revoke update (closed_at, closed_by) on public.shifts from authenticated;
drop policy if exists "members close open shifts" on public.shifts;

revoke update on public.shifts from authenticated;
revoke insert on public.shift_close from authenticated;
