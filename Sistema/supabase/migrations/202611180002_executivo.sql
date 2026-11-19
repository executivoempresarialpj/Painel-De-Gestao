begin;
create table private.account_access (
 user_id uuid primary key references auth.users on delete cascade,
 approved boolean not null default false, changed_by uuid references auth.users,
 changed_at timestamptz not null default now(), last_seen timestamptz
);
alter table private.account_access enable row level security;
revoke all on private.account_access from public, anon, authenticated;
drop policy members_isolation on public.members;
create policy members_isolation on public.members for select using
 ((user_id=auth.uid() and private.allowed(store_id,'catalog')) or private.allowed(store_id,'staff'));
revoke execute on function public.create_store(text) from public,anon,authenticated;
alter table public.stores add column default_minimum numeric(14,3) not null default 0 check(default_minimum>=0),
 add column default_unit text not null default 'un' check(length(trim(default_unit)) between 1 and 16);
create or replace function private.allowed(s uuid, capability text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.members m join public.stores t on t.id=m.store_id
    where m.store_id=s and m.user_id=auth.uid() and exists(select 1 from private.account_access a where a.user_id=m.user_id and a.approved) and m.active and t.status='active'
    and (t.expires_on is null or t.expires_on >= (now() at time zone t.timezone)::date)
    and (m.role='owner' or capability in ('catalog','sell','own_sales') or
        (m.role='manager' and capability=any(m.permissions))))
$$;
create or replace function public.store_context() returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  update private.account_access set last_seen=now() where user_id=auth.uid() and approved
    and (last_seen is null or last_seen<now()-interval '5 minutes') and exists(select 1 from public.members m where m.user_id=auth.uid() and private.allowed(m.store_id,'catalog'));
  return jsonb_build_object('master',private.is_master(),'stores',coalesce((
    select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'role',m.role,'permissions',m.permissions,'timezone',s.timezone,'minimum',s.default_minimum,'unit',s.default_unit,
      'available', private.allowed(s.id,'catalog')) order by s.name)
    from public.members m join public.stores s on s.id=m.store_id where m.user_id=auth.uid() and m.active and exists(select 1 from private.account_access a where a.user_id=m.user_id and a.approved)),'[]'));
end
$$;
create or replace function public.master_list() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_master() then raise exception 'Acesso restrito.' using errcode='42501'; end if;
  return jsonb_build_object('stores',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from public.stores t),'[]'),
    'registered',(select count(*) from auth.users),
    'pending',coalesce((select jsonb_agg(email order by email) from (
      select u.email from auth.users u where u.email_confirmed_at is not null and not exists(
        select 1 from private.account_access a where a.user_id=u.id)
      order by u.email limit 100) pending_accounts),'[]'::jsonb),
    'authorized',(select count(*) from private.account_access where approved),
    'recent',(select count(*) from private.account_access where last_seen>=now()-interval '24 hours'),
    'plans',(select jsonb_agg(to_jsonb(p) order by p.user_limit) from public.plans p));
end $$;

create function public.set_account_access(account_email text, allow_access boolean) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if not private.is_master() then raise exception 'Acesso restrito.' using errcode='42501'; end if;
 select id into target from auth.users where lower(email)=lower(trim(account_email)) and email_confirmed_at is not null;
 if target is null then raise exception 'Conta confirmada não encontrada.'; end if;
 insert into private.account_access(user_id,approved,changed_by) values(target,allow_access,auth.uid())
 on conflict(user_id) do update set approved=excluded.approved,changed_by=excluded.changed_by,changed_at=now();
end $$;
create function public.save_preferences(s uuid, store_name text, zone text, minimum numeric, unit text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.save_store(s,store_name,zone);
 update public.stores set default_minimum=minimum,default_unit=trim(unit) where id=s;
end $$;
create or replace function public.additions_report(s uuid, start_date date, end_date date, q text, page_number integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare zone text;
begin
  if not (private.allowed(s,'stock') or private.allowed(s,'reports')) then perform private.require_access(s,'stock'); end if;
  select timezone into zone from public.stores where id=s;
  return coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
    select v.*,p.name as product,m.name as operator from public.movements v
    join public.products p on p.id=v.product_id join public.members m on m.store_id=v.store_id and m.user_id=v.user_id
    where v.store_id=s and v.kind in ('entry','opening') and (start_date is null or v.created_at>=start_date::timestamp at time zone zone)
      and (end_date is null or v.created_at<(end_date+1)::timestamp at time zone zone)
      and (q='' or position(lower(q) in lower(p.name))>0 or position(lower(q) in lower(p.sku))>0)
    order by v.created_at desc,v.id desc limit 31 offset greatest(0,page_number)*30
  ) h),'[]');
end $$;

create table private.stock_receipts(store_id uuid references public.stores, reference text, items jsonb not null,
 primary key(store_id,reference));
alter table private.stock_receipts enable row level security;
revoke all on private.stock_receipts from public,anon,authenticated;
create function public.receive_sheet(s uuid, reference_code text, lines jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare previous jsonb; item record; p uuid; ref text:=trim(reference_code);
begin
 perform private.require_access(s,'stock');
 if ref is null or length(ref) not between 1 and 80 or jsonb_typeof(lines) is distinct from 'array' then raise exception 'Confira a referência e a planilha.'; end if;
 if jsonb_array_length(lines) not between 1 and 250 then raise exception 'Envie até 250 produtos.'; end if;
 if exists(select 1 from jsonb_to_recordset(lines) as i(sku text,quantity text)
   group by sku having count(*)>1) then raise exception 'SKU repetido na entrada.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s::text||ref,0));
 select items into previous from private.stock_receipts where store_id=s and reference=ref;
 if found then
  if previous<>lines then raise exception 'Referência já utilizada com outras quantidades.'; end if;
  return 0;
 end if;
 for item in select * from jsonb_to_recordset(lines) as i(sku text,quantity text) order by sku loop
  if coalesce(item.quantity,'') !~ '^[0-9]{1,11}([.][0-9]{1,3})?$' or item.quantity::numeric<=0 then raise exception 'Quantidade inválida para %.',item.sku; end if;
  select id into p from public.products where store_id=s and sku=item.sku and active;
  if not found then raise exception 'SKU indisponível: %.',item.sku; end if;
  perform private.move(s,p,item.quantity::numeric,'entry',ref);
 end loop;
 insert into private.stock_receipts values(s,ref,lines);
 return jsonb_array_length(lines);
end $$;
revoke all on function public.set_account_access(text,boolean) from public,anon;
grant execute on function public.set_account_access(text,boolean) to authenticated;
revoke all on function public.save_preferences(uuid,text,text,numeric,text) from public,anon;
grant execute on function public.save_preferences(uuid,text,text,numeric,text) to authenticated;
revoke all on function public.additions_report(uuid,date,date,text,integer) from public,anon;
grant execute on function public.additions_report(uuid,date,date,text,integer) to authenticated;
revoke all on function public.receive_sheet(uuid,text,jsonb) from public,anon;
grant execute on function public.receive_sheet(uuid,text,jsonb) to authenticated;
commit;
