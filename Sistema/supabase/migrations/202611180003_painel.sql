begin;
alter table public.stores add column if not exists client_name text;
create table if not exists private.executive_upgrade(id boolean primary key);
with applied as (insert into private.executive_upgrade values(true) on conflict do nothing returning id)
update public.members set permissions=array_append(permissions,'executive')
 where exists(select 1 from applied) and role='manager' and 'reports'=any(permissions) and not 'executive'=any(permissions);
create or replace function public.manage_member(s uuid, email_address text, display_name text, member_role text, enabled boolean, capabilities text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare member_id uuid; max_users integer;
begin
  perform private.require_access(s,'staff');
  if not exists(select 1 from public.members where store_id=s and user_id=auth.uid() and role='owner') then
    raise exception 'Apenas o proprietário pode gerenciar funcionários.' using errcode='42501';
  end if;
  if member_role is null or member_role not in ('manager','cashier') or enabled is null or coalesce(trim(display_name),'')='' then
    raise exception 'Dados do funcionário inválidos.';
  end if;
  select u.id into member_id from auth.users u where lower(u.email)=lower(trim(email_address)) and u.email_confirmed_at is not null;
  if member_id is null then raise exception 'O funcionário precisa criar uma conta e confirmar o e-mail.'; end if;
  select coalesce(t.user_limit,p.user_limit) into max_users from public.stores t join public.plans p on p.id=t.plan_id where t.id=s for update of t;
  if exists(select 1 from public.members where store_id=s and user_id=member_id and role='owner') then raise exception 'O vínculo do proprietário é protegido.'; end if;
  if enabled and not exists(select 1 from public.members where store_id=s and user_id=member_id and active)
    and (select count(*) from public.members where store_id=s and active)>=max_users then raise exception 'Limite de usuários ativos atingido.'; end if;
  insert into public.members values(s,member_id,trim(display_name),member_role,enabled,
    case when member_role='manager' then array(select x from unnest(capabilities) x where x in ('products','stock','sales','reports','executive','cancel')) else '{}' end)
  on conflict(store_id,user_id) do update set name=excluded.name,role=excluded.role,active=excluded.active,permissions=excluded.permissions;
  insert into public.audit_logs(store_id,user_id,action,entity_id,details) values(s,auth.uid(),'member_saved',member_id,jsonb_build_object('active',enabled,'role',member_role));
end $$;
create or replace function public.store_context() returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  update private.account_access set last_seen=now() where user_id=auth.uid() and approved
    and (last_seen is null or last_seen<now()-interval '5 minutes') and exists(select 1 from public.members m where m.user_id=auth.uid() and private.allowed(m.store_id,'catalog'));
  return jsonb_build_object('master',private.is_master(),'stores',coalesce((
    select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'displayName',case when m.role='owner' then coalesce(s.client_name,m.name) else m.name end,'role',m.role,'permissions',m.permissions,'timezone',s.timezone,'minimum',s.default_minimum,'unit',s.default_unit,
      'available', private.allowed(s.id,'catalog')) order by s.name)
    from public.members m join public.stores s on s.id=m.store_id where m.user_id=auth.uid() and m.active and exists(select 1 from private.account_access a where a.user_id=m.user_id and a.approved)),'[]'));
end
$$;
create or replace function private.report_data(s uuid, from_day date, to_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare zone text; today date; this_month date; result jsonb;
begin

  if from_day is null or to_day is null or to_day<from_day or to_day-from_day>366 then raise exception 'Selecione um período de até 367 dias.'; end if;
  select timezone into zone from public.stores where id=s;
  today:=(now() at time zone zone)::date;
  this_month:=date_trunc('month',today)::date;
  with completed as (
    select a.*,(a.created_at at time zone zone)::date as day from public.sales a where store_id=s and status='completed'
  ), selected as (
    select * from completed where day between from_day and to_day
  ), selected_items as (
    select i.* from public.sale_items i join selected a on a.id=i.sale_id
  ), monthly as (
    select date_trunc('month',day)::date as date,count(*) as sales,sum(total) as revenue from completed
    where day>=date_trunc('month',to_day)::date-interval '11 months' and day<=to_day group by 1
  )
  select jsonb_build_object(
    'metrics',(select jsonb_build_object('today_sales',count(*) filter(where day=today),'month_sales',count(*) filter(where day between this_month and today),
      'today_revenue',coalesce(sum(total) filter(where day=today),0),'month_revenue',coalesce(sum(total) filter(where day between this_month and today),0),
      'all_revenue',coalesce(sum(total),0),'ticket',coalesce(avg(total) filter(where day between from_day and to_day),0),
      'period_sales',count(*) filter(where day between from_day and to_day),
      'period_revenue',coalesce(sum(total) filter(where day between from_day and to_day),0),
      'month_profit',coalesce(sum(total) filter(where day between this_month and today),0)-
        coalesce((select sum(round(i.quantity*i.cost,2)) from public.sale_items i join completed a on a.id=i.sale_id where a.day between this_month and today),0),
      'period_profit',coalesce(sum(total) filter(where day between from_day and to_day),0)-coalesce((select sum(round(i.quantity*i.cost,2)) from selected_items i),0),
      'units_sold',coalesce((select sum(quantity) from selected_items),0)) from completed),
    'inventory',(select jsonb_build_object('products',count(*),'items',coalesce(sum(stock),0),'value',coalesce(sum(round(stock*cost,2)),0),
      'low',count(*) filter(where active and stock>0 and stock<=minimum),'empty',count(*) filter(where active and stock=0)) from public.products where store_id=s),
    'daily',(select jsonb_agg(to_jsonb(d) order by d.date) from (
      select from_day+series.n as date, count(a.id) as sales,coalesce(sum(a.total),0) as revenue
      from generate_series(0,to_day-from_day) as series(n) left join selected a on a.day=from_day+series.n group by 1
    ) d),
    'monthly',(select jsonb_agg(jsonb_build_object('date',g.date::date,'sales',coalesce(m.sales,0),'revenue',coalesce(m.revenue,0)) order by g.date)
      from generate_series(date_trunc('month',to_day)-interval '11 months',date_trunc('month',to_day),interval '1 month') as g(date)
      left join monthly m on m.date=g.date::date),
    'ranking',coalesce((select jsonb_agg(to_jsonb(r) order by r.quantity desc,r.name) from (
      select product_id,(array_agg(name order by sale_id))[1] as name,sum(quantity) as quantity,
        sum(round(price*quantity,2)) as gross,sum(round(cost*quantity,2)) as cost
      from selected_items group by product_id
    ) r),'[]'),
    'categories',coalesce((select jsonb_agg(to_jsonb(c) order by c.quantity desc,c.name) from (
      select category as name,sum(quantity) as quantity from selected_items group by category
    ) c),'[]'),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.revenue desc) from (
      select payment as name,count(*) as sales,sum(total) as revenue from selected group by payment
    ) p),'[]')
  ) into result;
  return result;
end $$;
revoke all on function private.report_data(uuid,date,date) from public,anon,authenticated;
create or replace function public.store_report(s uuid,from_day date,to_day date) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
 begin perform private.require_access(s,'reports'); return private.report_data(s,from_day,to_day); end $$;
create or replace function public.executive_report(s uuid,from_day date,to_day date) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
 begin perform private.require_access(s,'executive'); return private.report_data(s,from_day,to_day); end $$;

create or replace function public.save_client(s uuid,company text,plan text,state text,expiry date,seats integer,owner_email text,client text)
returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if not private.is_master() then raise exception 'Acesso restrito.' using errcode='42501'; end if;
 if coalesce(length(trim(client)),0) not between 1 and 120 then raise exception 'Informe o nome do cliente.'; end if;
 target:=public.master_save(s,company,plan,state,expiry,seats,owner_email);
 update public.stores set client_name=trim(client) where id=target;
 return target;
end $$;
alter table public.products add column if not exists empty_event uuid;
update public.products set empty_event=gen_random_uuid() where active and stock=0 and empty_event is null;
create or replace function private.track_empty() returns trigger language plpgsql set search_path='' as $$
begin
 if new.active and new.stock=0 then new.empty_event:=coalesce(new.empty_event,gen_random_uuid());
 else new.empty_event:=null; end if;
 return new;
end $$;
drop trigger if exists track_empty on public.products;
create trigger track_empty before insert or update of stock,active on public.products for each row execute function private.track_empty();
create index if not exists products_empty_store on public.products(store_id,id) where empty_event is not null;
create table if not exists private.seen_stock(user_id uuid references auth.users on delete cascade,product_id uuid references public.products on delete cascade,event uuid not null,primary key(user_id,product_id));
revoke all on private.seen_stock from public,anon,authenticated;
create or replace function public.stock_notifications(s uuid,review boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
 perform private.require_access(s,'catalog');
 if not review then
 return jsonb_build_object('unread',exists(select 1 from public.products p where p.store_id=s and p.empty_event is not null and not exists(select 1 from private.seen_stock a where a.user_id=auth.uid() and a.product_id=p.id and a.event=p.empty_event)));
 end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
 select p.id,p.name,p.sku,p.empty_event from public.products p where p.store_id=s and p.empty_event is not null and not exists(select 1 from private.seen_stock a where a.user_id=auth.uid() and a.product_id=p.id and a.event=p.empty_event)
 order by p.name,p.id limit 50) x;
 insert into private.seen_stock(user_id,product_id,event) select auth.uid(),id,empty_event from jsonb_to_recordset(rows) as x(id uuid,empty_event uuid)
 on conflict(user_id,product_id) do update set event=excluded.event;
 return jsonb_build_object('items',rows);
end $$;
create or replace function public.filtered_catalog(s uuid, q text default '', selected_category uuid default null, page_number integer default 0, page_size integer default 40, only_active boolean default false,availability text default 'all') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_access(s,'catalog');
  return coalesce((select jsonb_agg(to_jsonb(p) - case when private.allowed(s,'products') or private.allowed(s,'reports') then '' else 'cost' end)
    from (select p.*, c.name as category from public.products p left join public.categories c on c.id=p.category_id
      where p.store_id=s and (availability='all' or (p.active and ((availability='empty' and p.stock=0) or (availability='low' and p.stock>0 and p.stock<=p.minimum)))) and (not only_active or p.active) and (p.active or private.allowed(s,'products') or private.allowed(s,'stock') or private.allowed(s,'reports'))
        and (selected_category is null or p.category_id=selected_category)
        and (q='' or position(lower(q) in lower(p.name))>0 or position(lower(q) in lower(p.sku))>0 or p.barcode=q)
      order by (q<>'' and p.barcode=q) desc nulls last, (q<>'' and lower(p.sku)=lower(q)) desc, p.name,p.id limit greatest(1,least(page_size,101)) offset greatest(0,page_number)*greatest(1,least(page_size,101))) p),'[]');
end $$;
revoke all on function public.store_report(uuid,date,date) from public,anon;
grant execute on function public.store_report(uuid,date,date) to authenticated;
revoke all on function public.executive_report(uuid,date,date) from public,anon;
grant execute on function public.executive_report(uuid,date,date) to authenticated;
revoke all on function public.save_client(uuid,text,text,text,date,integer,text,text) from public,anon;
grant execute on function public.save_client(uuid,text,text,text,date,integer,text,text) to authenticated;
revoke all on function public.stock_notifications(uuid,boolean) from public,anon;
grant execute on function public.stock_notifications(uuid,boolean) to authenticated;
revoke all on function public.filtered_catalog(uuid,text,uuid,integer,integer,boolean,text) from public,anon;
grant execute on function public.filtered_catalog(uuid,text,uuid,integer,integer,boolean,text) to authenticated;
create or replace function public.manager_access() returns boolean language sql stable security definer set search_path='' as $$ select private.is_master() $$;
revoke all on function public.manager_access() from public,anon;
grant execute on function public.manager_access() to authenticated;
create index if not exists audit_store_recent on public.audit_logs(store_id,id desc);
create or replace function public.company_audit(s uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_master() then raise exception 'Acesso restrito.' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
 select a.id,a.created_at,a.action,u.email from public.audit_logs a join auth.users u on u.id=a.user_id
 where a.store_id=s order by a.id desc limit 20) x),'[]');
end $$;
revoke all on function public.company_audit(uuid) from public,anon;
grant execute on function public.company_audit(uuid) to authenticated;
commit;
