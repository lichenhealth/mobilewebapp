-- THE LICHEN BROWSER EXTENSION (founder 2026-11-25: "if someone is
-- purchasing something at a store and you have a coupon, alert them… lets do
-- the browser extension").
--
-- The extension never holds a Lichen session. It holds ONE narrow token that
-- can only read the member's own coupons (the `coupons-ext` edge fn checks
-- it). Only the hash is stored; the plain token is shown once, to the
-- extension, at pairing. Matching shops to coupons happens INSIDE the
-- extension — the sites a member visits never leave their browser.

create table if not exists public.extension_tokens (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  token_hash   text not null unique,
  label        text check (label is null or char_length(label) <= 80),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists extension_tokens_owner_idx on public.extension_tokens (profile_id);
alter table public.extension_tokens enable row level security;
drop policy if exists "extension_tokens: owner reads" on public.extension_tokens;
create policy "extension_tokens: owner reads" on public.extension_tokens for select to authenticated
  using (profile_id = auth.uid());
drop policy if exists "extension_tokens: owner revokes" on public.extension_tokens;
create policy "extension_tokens: owner revokes" on public.extension_tokens for delete to authenticated
  using (profile_id = auth.uid());
revoke all on public.extension_tokens from anon;
revoke insert, update on public.extension_tokens from authenticated;

-- Mint: returns the plain token ONCE. At most 5 live tokens per member (the
-- oldest goes) — one per browser is the normal case.
create or replace function public.mint_extension_token(p_label text default null)
returns text language plpgsql security definer set search_path to 'public', 'extensions' as $func$
declare v_me uuid := auth.uid(); v_token text;
begin
  if v_me is null then raise exception 'Sign in first.'; end if;
  v_token := 'lx_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into extension_tokens(profile_id, token_hash, label)
  values (v_me, encode(extensions.digest(v_token, 'sha256'), 'hex'), left(nullif(trim(p_label), ''), 80));
  delete from extension_tokens where id in (
    select id from extension_tokens where profile_id = v_me order by created_at desc offset 5);
  return v_token;
end $func$;
revoke all on function public.mint_extension_token(text) from public, anon;
grant execute on function public.mint_extension_token(text) to authenticated;
