-- Keep anonymous device workspaces private and make the owner checks efficient.
drop policy if exists "song charts are private to their owner" on public.song_charts;
create policy "song charts are private to their owner"
  on public.song_charts for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "analysis jobs are private to their owner" on public.analysis_jobs;
create policy "analysis jobs are private to their owner"
  on public.analysis_jobs for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create index if not exists analysis_jobs_chart_id_idx
  on public.analysis_jobs (chart_id);

-- Edge Functions use the service role and bypass RLS. These explicit deny
-- policies document that browser roles must never read admin credentials.
drop policy if exists "admin access is edge only" on public.faithful_admin_access;
create policy "admin access is edge only"
  on public.faithful_admin_access for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "admin sessions are edge only" on public.faithful_admin_sessions;
create policy "admin sessions are edge only"
  on public.faithful_admin_sessions for all to anon, authenticated
  using (false) with check (false);
