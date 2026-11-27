-- LICHEN'S DEFAULT VOICE PER KIND OF DEVICE (founder 2026-11-27: "can I set a
-- default voice for lichen users on iphone, and on android by listening to
-- them via chrome?"). platform_settings key 'default_voices' =
-- {"iphone": "<voice name>", "android": …, "mac": …, "windows": …}. A device
-- uses it only when it HAS that voice and the person hasn't chosen their own;
-- otherwise the device's usual voice. Admins set it from a device of that
-- kind, after hearing it.
create or replace function public.set_default_voice(p_platform text, p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $func$
declare cur jsonb;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only Lichen admins can set the default voice.';
  end if;
  if p_platform not in ('iphone','android','mac','windows','other') then
    raise exception 'Unknown kind of device.';
  end if;
  if p_name is not null and (length(p_name) < 1 or length(p_name) > 120) then
    raise exception 'That voice name doesn''t look right.';
  end if;
  select value into cur from platform_settings where key = 'default_voices';
  cur := coalesce(cur, '{}'::jsonb);
  if p_name is null or p_name = '' then cur := cur - p_platform;
  else cur := cur || jsonb_build_object(p_platform, p_name); end if;
  insert into platform_settings (key, value, updated_at, updated_by)
  values ('default_voices', cur, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
end $func$;
revoke all on function public.set_default_voice(text, text) from public, anon;
grant execute on function public.set_default_voice(text, text) to authenticated;
