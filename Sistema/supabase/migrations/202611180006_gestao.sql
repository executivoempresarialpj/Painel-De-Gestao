begin;
alter table private.logos add column if not exists native boolean not null default false;
create or replace function public.configure_company(s uuid,company text,plan text,state text,expiry date,seats integer,owner_email text,client text,kind text,picture text)
returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; old_logo uuid; new_logo uuid;
begin
 target:=public.save_client(s,company,plan,state,expiry,seats,owner_email,client);
 if s is null then update public.stores set mode=kind where id=target; end if;
 if picture is not null then
 if length(picture)>400000 or picture not like 'iVBOR%' then raise exception 'Logo inválida.'; end if;
 select logo_id into old_logo from public.stores where id=target for update;
 new_logo:=gen_random_uuid(); insert into private.logos(id,picture,native) values(new_logo,picture,true);
 update public.stores set logo_id=new_logo where id=target;
 delete from private.logos where id=old_logo;
 end if; return target;
end $$;

create or replace function public.brand_asset(token uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('picture',picture,'native',native) from private.logos where id=token
$$;
alter table private.jobs add column if not exists expense numeric(14,2) not null default 0 check(expense>=0),
 add column if not exists method text check(method in ('cash','pix','debit','credit','other')),
 add column if not exists cancelled boolean not null default false;
create or replace function public.record_job(s uuid,k uuid,description text,buyer text,price numeric,d date,expense numeric,method text)
returns void language plpgsql security definer set search_path='' as $$
declare prior private.jobs%rowtype;
begin
 perform private.require_access(s,'sell');
 if expense is null or expense<0 or expense<>round(expense,2) or method is null or method not in ('cash','pix','debit','credit','other') then
  raise exception 'Confira o custo e a forma de pagamento.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(k::text,0));
 select * into prior from private.jobs where id=k;
 perform public.add_job(s,k,description,buyer,price,d);
 if prior.id is null then
   update private.jobs j set expense=record_job.expense,method=record_job.method where j.id=k;
 elsif prior.expense<>expense or prior.method is distinct from method then
   raise exception 'Solicitação já utilizada.';
 end if;
end $$;
create or replace function public.cancel_job(s uuid,k uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_access(s,'cancel');
 update private.jobs set cancelled=true where store_id=s and id=k;
 if not found then raise exception 'Serviço não encontrado.'; end if;
end $$;
create or replace function public.service_overview(s uuid,a date,b date,search text default '',state text default 'all') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare financial boolean;
begin
 perform private.require_access(s,'catalog');
 if a is null or b is null or b<a or b-a>366 then raise exception 'Selecione um período de até 367 dias.'; end if;
 financial:=private.allowed(s,'executive') or private.allowed(s,'reports');
 return (with j as (
   select * from private.jobs where store_id=s and day between a and b and (financial or actor=auth.uid())
     and (search='' or title ilike '%'||search||'%' or customer ilike '%'||search||'%')
     and (state='all' or cancelled=(state='cancelled'))
 ), active as (select * from j where not cancelled)
 select jsonb_build_object(
  'count',count(*),'revenue',coalesce(sum(amount),0),
  'cost',case when financial then coalesce(sum(expense),0) end,
  'inventory',case when financial then (select coalesce(sum(stock*cost),0) from public.products where store_id=s) end,
  'daily',(select coalesce(jsonb_agg(to_jsonb(x) order by x.date),'[]') from (select day date,count(*) sales,sum(amount) revenue from active group by day)x),
  'top',(select coalesce(jsonb_agg(to_jsonb(x) order by x.revenue desc),'[]') from (select title,count(*) count,sum(amount) revenue from active group by title order by revenue desc limit 5)x),
  'rows',(select coalesce(jsonb_agg(to_jsonb(x) order by day desc,created_at desc),'[]') from (
    select id,title,customer,day,created_at,amount,case when financial then expense end as cost,method,cancelled from j order by day desc,created_at desc limit 100
  )x)
 ) from active);
end $$;

create or replace function public.delete_customer_account(address text, confirmation text) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid; owned record; owned_ids uuid[];
begin
 if not private.is_master() then raise exception 'Acesso restrito.'; end if;
 if length(trim(address))=0 or lower(trim(address)) is distinct from lower(trim(confirmation)) then raise exception 'Confirme o e-mail da conta.'; end if;
 select id into target from auth.users where lower(email)=lower(trim(address)) for update;
 if target is null then raise exception 'Conta não encontrada.'; end if;
 if exists(select 1 from public.platform_admins where user_id=target) then raise exception 'Conta de gestor protegida.'; end if;
 select coalesce(array_agg(m.store_id),'{}') into owned_ids from public.members m where m.user_id=target and m.role='owner'
   and not exists(select 1 from public.members n where n.store_id=m.store_id and n.role='owner' and n.user_id<>target);
 if exists(select 1 from public.sales where operator_id=target and store_id<>all(owned_ids))
 or exists(select 1 from public.movements where user_id=target and store_id<>all(owned_ids))
 or exists(select 1 from public.cancellations where user_id=target and store_id<>all(owned_ids))
 or exists(select 1 from private.jobs where actor=target and store_id<>all(owned_ids))
 or exists(select 1 from public.members where user_id=target and role='owner' and store_id<>all(owned_ids)) then
   raise exception 'A conta tem histórico ou propriedade compartilhada em outra empresa. Remova o acesso nessa empresa para preservar o histórico.';
 end if;
 for owned in select id,name from public.stores where id=any(owned_ids) order by id loop
   perform public.manage_company_access(owned.id,'',owned.name,true);
 end loop;
 delete from public.audit_logs where user_id=target;
 delete from private.product_imports where user_id=target;
 update private.account_access set changed_by=null where changed_by=target;
 delete from public.members where user_id=target;
 delete from auth.users where id=target;
end $$;
revoke all on function public.record_job(uuid,uuid,text,text,numeric,date,numeric,text),public.cancel_job(uuid,uuid),public.service_overview(uuid,date,date,text,text),public.delete_customer_account(text,text) from public,anon;
grant execute on function public.record_job(uuid,uuid,text,text,numeric,date,numeric,text),public.cancel_job(uuid,uuid),public.service_overview(uuid,date,date,text,text),public.delete_customer_account(text,text) to authenticated;
commit;
