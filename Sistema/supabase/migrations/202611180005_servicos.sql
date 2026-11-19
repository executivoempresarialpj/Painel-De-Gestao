begin;
alter table public.stores add column if not exists mode text not null default 'retail' check(mode in ('retail','services')), add column if not exists logo_id uuid;
create table if not exists private.logos(id uuid primary key, picture text not null);
create table if not exists private.jobs(id uuid primary key,store_id uuid not null references public.stores on delete cascade,actor uuid not null references auth.users,title text not null,customer text,amount numeric(14,2) not null,day date not null,created_at timestamptz not null default now());
create index if not exists jobs_store_day on private.jobs(store_id,day desc);
create or replace function public.configure_company(s uuid,company text,plan text,state text,expiry date,seats integer,owner_email text,client text,kind text,picture text)
returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; old_logo uuid; new_logo uuid;
begin
 target:=public.save_client(s,company,plan,state,expiry,seats,owner_email,client);
 if s is null then update public.stores set mode=kind where id=target; end if;
 if picture is not null then
 if length(picture)>400000 or picture not like 'iVBOR%' then raise exception 'Logo inválida.'; end if;
 select logo_id into old_logo from public.stores where id=target for update;
 new_logo:=gen_random_uuid(); insert into private.logos values(new_logo,picture);
 update public.stores set logo_id=new_logo where id=target;
 delete from private.logos where id=old_logo;
 end if; return target;
end $$;
create or replace function public.brand_image(token uuid) returns text language sql stable security definer set search_path='' as $$ select picture from private.logos where id=token $$;
create or replace function public.manage_company_access(s uuid,address text,confirmation text,remove_company boolean) returns void language plpgsql security definer set search_path='' as $$
declare cname text; logo uuid;
begin
 if not private.is_master() then raise exception 'Acesso restrito.'; end if;
 select name,logo_id into strict cname,logo from public.stores where id=s for update;
 if not remove_company then
 update public.members set active=false where store_id=s and user_id=(select id from auth.users where lower(email)=lower(trim(address))) and active;
 if not found then raise exception 'Vínculo ativo não encontrado.'; end if;
 return; end if;
 if confirmation is distinct from cname then raise exception 'Digite o nome exato da empresa.'; end if;
delete from private.product_imports where store_id=s;
delete from private.stock_receipts where store_id=s;
delete from public.movements where store_id=s;
delete from public.cancellations where store_id=s;
delete from public.sale_items where store_id=s;
delete from public.sales where store_id=s;
delete from public.products where store_id=s;
delete from public.categories where store_id=s;
delete from public.audit_logs where store_id=s;
delete from public.members where store_id=s;
delete from public.stores where id=s; delete from private.logos where id=logo;
end $$;
create or replace function private.check_sale_mode() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if exists(select 1 from public.stores where id=new.store_id and mode='services') then raise exception 'Esta empresa registra serviços.'; end if; return new; end $$;
drop trigger if exists sale_mode on public.sales;
create trigger sale_mode before insert on public.sales for each row execute function private.check_sale_mode();
create or replace function public.add_job(s uuid,k uuid,description text,buyer text,price numeric,d date) returns void language plpgsql security definer set search_path='' as $$ begin
 perform private.require_access(s,'sell');
 if not exists(select 1 from public.stores where id=s and mode='services' and d<=(now() at time zone timezone)::date) or length(trim(description)) not between 1 and 120 or length(buyer)>120 or price<=0 or price<>round(price,2) then raise exception 'Confira os dados do serviço.'; end if;
 insert into private.jobs values(k,s,auth.uid(),trim(description),nullif(trim(buyer),''),price,d,now()) on conflict(id) do nothing;
 if not found and not exists(select 1 from private.jobs where id=k and store_id=s and actor=auth.uid() and title=trim(description) and customer is not distinct from nullif(trim(buyer),'') and amount=price and day=d) then raise exception 'Solicitação já utilizada.'; end if;
end $$;
create or replace function public.jobs_view(s uuid,a date,b date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare manager boolean;
begin
 perform private.require_access(s,'catalog'); manager:=private.allowed(s,'executive') or private.allowed(s,'reports');
 return (with j as (select * from private.jobs where store_id=s and day between a and b and (manager or actor=auth.uid()))
 select jsonb_build_object('count',count(*),'revenue',coalesce(sum(amount),0),'inventory',case when manager then (select coalesce(sum(stock*cost),0) from public.products where store_id=s) end,'rows',(select coalesce(jsonb_agg(to_jsonb(x) order by day desc,created_at desc),'[]') from (select id,title,customer,day,created_at,amount from j order by day desc,created_at desc limit 100)x)) from j);
end $$;
revoke all on function public.configure_company(uuid,text,text,text,date,integer,text,text,text,text) from public,anon; grant execute on function public.configure_company(uuid,text,text,text,date,integer,text,text,text,text) to authenticated;
revoke all on function public.manage_company_access(uuid,text,text,boolean) from public,anon; grant execute on function public.manage_company_access(uuid,text,text,boolean) to authenticated;
revoke all on function public.add_job(uuid,uuid,text,text,numeric,date) from public,anon; grant execute on function public.add_job(uuid,uuid,text,text,numeric,date) to authenticated;
revoke all on function public.jobs_view(uuid,date,date) from public,anon; grant execute on function public.jobs_view(uuid,date,date) to authenticated;
create or replace function public.store_context() returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  update private.account_access set last_seen=now() where user_id=auth.uid() and approved
    and (last_seen is null or last_seen<now()-interval '5 minutes') and exists(select 1 from public.members m where m.user_id=auth.uid() and private.allowed(m.store_id,'catalog'));
  return jsonb_build_object('master',private.is_master(),'stores',coalesce((
    select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'mode',s.mode,'logo',s.logo_id,'displayName',case when m.role='owner' then coalesce(s.client_name,m.name) else m.name end,'role',m.role,'permissions',m.permissions,'timezone',s.timezone,'minimum',s.default_minimum,'unit',s.default_unit,
      'available', private.allowed(s.id,'catalog')) order by s.name)
    from public.members m join public.stores s on s.id=m.store_id where m.user_id=auth.uid() and m.active and exists(select 1 from private.account_access a where a.user_id=m.user_id and a.approved)),'[]'));
end
$$;
create or replace function private.track_empty() returns trigger language plpgsql set search_path='' as $$
begin
 if new.active and new.stock<=new.minimum then new.empty_event:=case when tg_op='UPDATE' and (old.stock=0)<>(new.stock=0) then gen_random_uuid() else coalesce(new.empty_event,gen_random_uuid()) end;
 else new.empty_event:=null; end if;
 return new;
end $$;
drop trigger if exists track_empty on public.products;
create trigger track_empty before insert or update of stock,active,minimum on public.products for each row execute function private.track_empty();
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
 select p.id,p.name,p.sku,p.stock,p.empty_event from public.products p where p.store_id=s and p.empty_event is not null and not exists(select 1 from private.seen_stock a where a.user_id=auth.uid() and a.product_id=p.id and a.event=p.empty_event)
 order by p.name,p.id limit 50) x;
 insert into private.seen_stock(user_id,product_id,event) select auth.uid(),id,empty_event from jsonb_to_recordset(rows) as x(id uuid,empty_event uuid)
 on conflict(user_id,product_id) do update set event=excluded.event;
 return jsonb_build_object('items',rows);
end $$;
update public.products set minimum=minimum where active and stock>0 and stock<=minimum;
commit;
