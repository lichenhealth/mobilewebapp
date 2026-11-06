-- CURRENT-CY ONLY LISTINGS (founder 2026-11-06: guests off Lichen default
-- to paying in DOLLARS, "or if the seller will only deal in current-cy,
-- which means they'd need to join the platform"). The seller's switch rides
-- posts.details.currentcyOnly (Compose, paid listings). guest_post carries
-- it out (return type grows → DROP/recreate, grants re-applied); the
-- guest's ask is refused server-side so the page can't be talked past.

drop function if exists public.guest_post(text);
create or replace function public.guest_post(p_token text)
returns table (
  guest_name text, post_id uuid, title text, body text, photos text[],
  price text, price_cents integer, modes jsonb, seller_name text, seller_kind text,
  order_id uuid, order_status text, order_price_cents integer,
  order_paid_at timestamptz, order_pending_at timestamptz, currentcy_only boolean
)
language sql stable security definer set search_path = public as $func$
  select g.name, p.id, p.title, p.body,
         coalesce(
           array(select m->>'url'
                 from jsonb_array_elements(
                   case when jsonb_typeof(p.details->'media') = 'array'
                        then p.details->'media' else '[]'::jsonb end) m
                 where m->>'type' = 'photo'),
           '{}'::text[])
           || case when p.image_url is not null then array[p.image_url] else '{}'::text[] end,
         p.details->>'price',
         public._post_price_cents(p.details),
         coalesce(p.details->'modes', '[]'::jsonb),
         coalesce(sp.name, pr.full_name, 'A Lichen member'),
         case when p.author_space_id is not null then sp.kind::text else 'person' end,
         o.id, o.status, o.price_cents, o.paid_at, o.payment_pending_at,
         coalesce((p.details->>'currentcyOnly')::boolean, false)
  from public.post_guests g
  join public.posts p on p.id = g.post_id
  left join public.profiles pr on pr.id = p.author_id
  left join public.spaces sp on sp.id = p.author_space_id
  left join lateral (
    select * from public.post_orders po
    where po.guest_id = g.id
    order by (po.status in ('requested','accepted','paid')) desc, po.created_at desc
    limit 1
  ) o on true
  where g.token = p_token;
$func$;
revoke all on function public.guest_post(text) from public;
grant execute on function public.guest_post(text) to anon, authenticated;

create or replace function public.guest_request_purchase(p_token text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $func$
declare g record; p record; v_cents integer; v_order uuid; v_title text; v_admin record;
begin
  select * into g from public.post_guests where token = p_token;
  if g is null then raise exception 'This link isn''t valid anymore.'; end if;
  select * into p from public.posts where id = g.post_id;
  if p is null then raise exception 'This listing isn''t available anymore.'; end if;
  if coalesce((p.details->>'currentcyOnly')::boolean, false) then
    raise exception 'This seller trades this one in Current-cy only — join Lichen to buy it.';
  end if;
  v_cents := public._post_price_cents(p.details);
  if v_cents is null or v_cents < 100 then
    raise exception 'This listing has no dollar price to pay online — message the seller to arrange it.';
  end if;
  if v_cents > 500000 then
    raise exception 'Online checkout covers up to $5,000 — message the seller to arrange this one.';
  end if;
  if exists (select 1 from public.post_orders where guest_id = g.id and status in ('requested','accepted')) then
    raise exception 'You''ve already asked — the seller will answer soon.';
  end if;

  insert into public.post_orders (post_id, guest_id, seller_type, seller_id,
                                  buyer_name, buyer_email, buyer_phone, note, price_cents)
  values (p.id, g.id,
          case when p.author_space_id is not null then 'space' else 'profile' end,
          coalesce(p.author_space_id, p.author_id),
          g.name, g.email, g.phone, nullif(trim(coalesce(p_note, '')), ''), v_cents)
  returning id into v_order;

  v_title := coalesce(nullif(p.title, ''), left(coalesce(p.body, 'your listing'), 60));
  if p.author_space_id is null then
    perform public.notify(p.author_id, 'home', null, 'listing_order',
      coalesce(g.name, 'Someone off Lichen') || ' wants to buy ' || v_title,
      'They''re not on Lichen — accept and they''ll pay $' || (v_cents / 100.0)::numeric(12,2) || ' by card.',
      '/posts/' || p.id || '#orders', null);
  else
    for v_admin in select m.profile_id from public.space_members m
                   where m.space_id = p.author_space_id and m.role in ('admin','super_admin') loop
      perform public.notify(v_admin.profile_id, 'home', p.author_space_id, 'listing_order',
        coalesce(g.name, 'Someone off Lichen') || ' wants to buy ' || v_title,
        'Accept and they''ll pay $' || (v_cents / 100.0)::numeric(12,2) || ' by card, into the treasury.',
        '/posts/' || p.id || '#orders', null);
    end loop;
  end if;
  return v_order;
end $func$;
revoke all on function public.guest_request_purchase(text, text) from public;
grant execute on function public.guest_request_purchase(text, text) to anon, authenticated;
