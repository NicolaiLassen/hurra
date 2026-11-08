-- Archiving a session puts a finished party away without losing anything: it
-- leaves the host's list (and can be brought back) and keeps all its data.
alter table public.sessions add column archived_at timestamptz;
