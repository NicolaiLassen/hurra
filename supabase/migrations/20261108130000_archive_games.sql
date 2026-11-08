-- Archiving tidies a game away without losing anything: it disappears from the
-- host's list (and can be brought back), and its points keep counting.
alter table public.session_games add column archived_at timestamptz;
