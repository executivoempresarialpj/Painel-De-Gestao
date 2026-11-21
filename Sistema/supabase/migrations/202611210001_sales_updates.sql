begin;
alter table public.sales add column ice_cost numeric not null default 0;

create function private.catalog_key(label text) returns text
language sql immutable set search_path='' as $$
  select trim(regexp_replace(translate(lower(label),'áàâãäéêíóôõöúüç','aaaaaeeioooouuc'),'[^a-z0-9]+',' ','g'))
$$;
create function private.lock_ice_store(s uuid) returns void
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.stores where id=s and private.catalog_key(name) in ('adega do chefinho','adega chefinho')) then
    perform pg_advisory_xact_lock(hashtextextended('ice:'||s::text,0));
  end if;
end $$;
create function private.consume_sale_ice(s uuid, sale uuid, snapshots jsonb) returns void
language plpgsql set search_path='' as $$
declare units numeric; ice public.products%rowtype; matches integer;
begin
  if not exists(select 1 from public.stores where id=s and private.catalog_key(name) in ('adega do chefinho','adega chefinho')) then return; end if;
  select sum(quantity * case
     when private.catalog_key(name) ~ '^baldao (de )?(whisky|whiskey|hisky|uisque)( |$)' then 3
     when private.catalog_key(name) ~ '^copao( |$)' then 1 else 0 end)
    into units from jsonb_to_recordset(snapshots) as i(name text,quantity numeric);
  if coalesce(units,0)=0 then return; end if;
  select count(*) into matches from public.products where store_id=s and active and private.catalog_key(name) in ('gelo','gelos');
  if matches<>1 then raise exception 'Cadastre um único produto ativo chamado Gelo para vender o Baldão ou o Copão.'; end if;
  select * into ice from public.products where store_id=s and active and private.catalog_key(name) in ('gelo','gelos') for update;
  if not found or ice.stock<units then raise exception 'Estoque de gelo insuficiente. Esta venda precisa de % unidade(s) adicionais.',units; end if;
  perform private.move(s,ice.id,-units,'sale','Consumo automático de gelo',sale);
  update public.sales set ice_cost=round(ice.cost*units,2) where id=sale and store_id=s;
end $$;
revoke all on function private.catalog_key(text), private.lock_ice_store(uuid), private.consume_sale_ice(uuid,uuid,jsonb) from public,anon,authenticated;
create or replace function public.record_sale(s uuid, request_key uuid, items jsonb, rebate numeric, payment_method text,customer text,sold_on date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_sale public.sales%rowtype; item record; product public.products%rowtype; subtotal_value numeric:=0;
 normalized jsonb; snapshots jsonb:='[]'; category_name text; today date;
begin
  select (now() at time zone timezone)::date into today from public.stores where id=s;
  if sold_on>today then raise exception 'A data da venda deve ser hoje ou anterior.'; end if;
  customer:=nullif(trim(customer),''); if length(customer)>120 then raise exception 'Nome muito longo.'; end if;
  perform private.require_access(s,'sell');
  if request_key is null or rebate is null or rebate<0 or rebate<>round(rebate,2)
     or payment_method is null or payment_method not in ('cash','pix','debit','credit')
     or items is null or jsonb_typeof(items)<>'array' then raise exception 'Dados da venda inválidos.'; end if;
  if jsonb_array_length(items) not between 1 and 100 or exists(
    select 1 from jsonb_to_recordset(items) as i(id uuid,quantity numeric) where id is null or quantity is null or quantity<=0 or quantity<>round(quantity,3)
  ) then raise exception 'Informe de 1 a 100 itens com quantidades válidas.'; end if;
  select jsonb_agg(to_jsonb(x) order by x.id) into normalized from (
    select id,sum(quantity) as quantity from jsonb_to_recordset(items) as i(id uuid,quantity numeric) group by id) x;
  normalized:=jsonb_build_object('items',normalized,'rebate',rebate,'payment',payment_method);
  if sold_on is not null then normalized:=normalized||jsonb_build_object('date',sold_on); end if;
  if customer is not null then normalized:=normalized||jsonb_build_object('customer',customer); end if;
  perform pg_advisory_xact_lock(hashtextextended(s::text||auth.uid()::text||request_key::text,0));
  select * into current_sale from public.sales where store_id=s and operator_id=auth.uid() and request_id=request_key;
  if found then
    if current_sale.request_payload<>normalized then raise exception 'A chave já pertence a outra operação.'; end if;
    return jsonb_build_object('id',current_sale.id,'number',current_sale.number,'total',current_sale.total,'status',current_sale.status);
  end if;
  perform private.lock_ice_store(s);
  for item in select * from jsonb_to_recordset(normalized->'items') as i(id uuid,quantity numeric) order by id loop
    select * into product from public.products where id=item.id and store_id=s for update;
    if not found or not product.active then raise exception 'Um dos produtos está indisponível.'; end if;
    if product.stock<item.quantity then raise exception 'Estoque insuficiente para % (disponível: %).',product.name,product.stock; end if;
    select name into category_name from public.categories where id=product.category_id;
    subtotal_value:=subtotal_value+round(product.price*item.quantity,2);
    snapshots:=snapshots||jsonb_build_object('id',product.id,'name',product.name,'category',coalesce(category_name,'Sem categoria'),
       'quantity',item.quantity,'price',product.price,'cost',product.cost);
  end loop;
  if rebate>subtotal_value then raise exception 'O desconto excede o subtotal.'; end if;
  insert into public.sales(store_id,operator_id,request_id,request_payload,subtotal,discount,total,payment,customer_name,sale_day)
    values(s,auth.uid(),request_key,normalized,subtotal_value,rebate,subtotal_value-rebate,payment_method,customer,coalesce(sold_on,today)) returning * into current_sale;
  for item in select * from jsonb_to_recordset(snapshots) as i(id uuid,name text,category text,quantity numeric,price numeric,cost numeric) order by id loop
    insert into public.sale_items values(s,current_sale.id,item.id,item.name,item.category,item.quantity,item.price,item.cost);
    perform private.move(s,item.id,-item.quantity,'sale',null,current_sale.id);
  end loop;
  perform private.consume_sale_ice(s,current_sale.id,snapshots);
  return jsonb_build_object('id',current_sale.id,'number',current_sale.number,'total',current_sale.total,'status',current_sale.status);
end $$;
create or replace function public.finish_sale(s uuid, request_key uuid, items jsonb, rebate numeric, payment_method text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_sale public.sales%rowtype; item record; product public.products%rowtype; subtotal_value numeric:=0;
 normalized jsonb; snapshots jsonb:='[]'; category_name text;
begin
  perform private.require_access(s,'sell');
  if request_key is null or rebate is null or rebate<0 or rebate<>round(rebate,2)
     or payment_method is null or payment_method not in ('cash','pix','debit','credit')
     or items is null or jsonb_typeof(items)<>'array' then raise exception 'Dados da venda inválidos.'; end if;
  if jsonb_array_length(items) not between 1 and 100 or exists(
    select 1 from jsonb_to_recordset(items) as i(id uuid,quantity numeric) where id is null or quantity is null or quantity<=0 or quantity<>round(quantity,3)
  ) then raise exception 'Informe de 1 a 100 itens com quantidades válidas.'; end if;
  select jsonb_agg(to_jsonb(x) order by x.id) into normalized from (
    select id,sum(quantity) as quantity from jsonb_to_recordset(items) as i(id uuid,quantity numeric) group by id) x;
  normalized:=jsonb_build_object('items',normalized,'rebate',rebate,'payment',payment_method);
  perform pg_advisory_xact_lock(hashtextextended(s::text||auth.uid()::text||request_key::text,0));
  select * into current_sale from public.sales where store_id=s and operator_id=auth.uid() and request_id=request_key;
  if found then
    if current_sale.request_payload<>normalized then raise exception 'A chave já pertence a outra operação.'; end if;
    return jsonb_build_object('id',current_sale.id,'number',current_sale.number,'total',current_sale.total,'status',current_sale.status);
  end if;
  perform private.lock_ice_store(s);
  for item in select * from jsonb_to_recordset(normalized->'items') as i(id uuid,quantity numeric) order by id loop
    select * into product from public.products where id=item.id and store_id=s for update;
    if not found or not product.active then raise exception 'Um dos produtos está indisponível.'; end if;
    if product.stock<item.quantity then raise exception 'Estoque insuficiente para % (disponível: %).',product.name,product.stock; end if;
    select name into category_name from public.categories where id=product.category_id;
    subtotal_value:=subtotal_value+round(product.price*item.quantity,2);
    snapshots:=snapshots||jsonb_build_object('id',product.id,'name',product.name,'category',coalesce(category_name,'Sem categoria'),
       'quantity',item.quantity,'price',product.price,'cost',product.cost);
  end loop;
  if rebate>subtotal_value then raise exception 'O desconto excede o subtotal.'; end if;
  insert into public.sales(store_id,operator_id,request_id,request_payload,subtotal,discount,total,payment)
    values(s,auth.uid(),request_key,normalized,subtotal_value,rebate,subtotal_value-rebate,payment_method) returning * into current_sale;
  for item in select * from jsonb_to_recordset(snapshots) as i(id uuid,name text,category text,quantity numeric,price numeric,cost numeric) order by id loop
    insert into public.sale_items values(s,current_sale.id,item.id,item.name,item.category,item.quantity,item.price,item.cost);
    perform private.move(s,item.id,-item.quantity,'sale',null,current_sale.id);
  end loop;
  perform private.consume_sale_ice(s,current_sale.id,snapshots);
  return jsonb_build_object('id',current_sale.id,'number',current_sale.number,'total',current_sale.total,'status',current_sale.status);
end $$;
create or replace function public.cancel_sale(s uuid, sale uuid, why text, restore_stock boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare old_status text; item record;
begin
  perform private.require_access(s,'cancel');
  if coalesce(trim(why),'')='' or restore_stock is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  perform private.lock_ice_store(s);
  select status into old_status from public.sales where id=sale and store_id=s for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if old_status='cancelled' then return; end if;
  insert into public.cancellations(store_id,sale_id,user_id,reason,restocked) values(s,sale,auth.uid(),trim(why),restore_stock);
  if restore_stock then
    for item in select product_id,sum(quantity) as quantity from (
      select product_id,quantity from public.sale_items where sale_id=sale and store_id=s
      union all
      select product_id,-quantity from public.movements where sale_id=sale and store_id=s and kind='sale' and reason='Consumo automático de gelo'
    ) restored group by product_id order by product_id loop
      perform private.move(s,item.product_id,item.quantity,'reversal',trim(why),sale);
    end loop;
  end if;
  update public.sales set status='cancelled' where id=sale and store_id=s;
end $$;
create or replace function private.report_data(s uuid, from_day date, to_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare zone text; today date; this_month date; result jsonb;
begin

  if from_day is null or to_day is null or to_day<from_day or to_day-from_day>366 then raise exception 'Selecione um período de até 367 dias.'; end if;
  select timezone into zone from public.stores where id=s;
  today:=(now() at time zone zone)::date;
  this_month:=date_trunc('month',today)::date;
  with completed as (
    select a.*,coalesce(a.sale_day,(a.created_at at time zone zone)::date) as day from public.sales a where store_id=s and status='completed'
  ), selected as (
    select * from completed where day between from_day and to_day
  ), selected_items as (
    select i.*,round(i.quantity*i.price,2) as line_value,a.subtotal,a.discount,
      sum(round(i.quantity*i.price,2)) over(partition by i.sale_id order by i.product_id) as running
      from public.sale_items i join selected a on a.id=i.sale_id
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
      'today_profit',coalesce(sum(total-ice_cost) filter(where day=today),0)-
        coalesce((select sum(round(i.quantity*i.cost,2)) from public.sale_items i join completed a on a.id=i.sale_id where a.day=today),0),
      'month_profit',coalesce(sum(total-ice_cost) filter(where day between this_month and today),0)-
        coalesce((select sum(round(i.quantity*i.cost,2)) from public.sale_items i join completed a on a.id=i.sale_id where a.day between this_month and today),0),
      'period_profit',coalesce(sum(total-ice_cost) filter(where day between from_day and to_day),0)-coalesce((select sum(round(i.quantity*i.cost,2)) from selected_items i),0),
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
        sum(round(price*quantity,2)) as gross,sum(line_value-round(coalesce(discount*running/nullif(subtotal,0),0),2)
        +round(coalesce(discount*(running-line_value)/nullif(subtotal,0),0),2)-round(cost*quantity,2)) as profit,sum(round(cost*quantity,2)) as cost
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
alter table public.sales add column push_claimed boolean not null default false;
create table private.sale_push_subscriptions (
  store_id uuid not null,
  user_id uuid not null,
  endpoint text not null,
  subscription jsonb not null,
  primary key(store_id,user_id,endpoint),
  foreign key(store_id,user_id) references public.members(store_id,user_id) on delete cascade
);
create index sale_push_endpoint on private.sale_push_subscriptions(endpoint);
create function public.register_sale_push(s uuid, subscription jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare destination text:=subscription->>'endpoint';
begin
  perform private.require_access(s,'own_sales');
  if destination is null or length(destination)>1500 or octet_length(subscription::text)>2500 then
    raise exception 'Inscrição inválida.';
  end if;
  delete from private.sale_push_subscriptions p where p.endpoint=destination and p.user_id<>auth.uid();
  insert into private.sale_push_subscriptions values(s,auth.uid(),destination,subscription)
    on conflict(store_id,user_id,endpoint) do update set subscription=excluded.subscription;
end $$;
create function public.unregister_sale_push(destination text, s uuid default null) returns void
language sql security definer set search_path='' as $$
  delete from private.sale_push_subscriptions p where p.user_id=auth.uid() and p.endpoint=destination and (s is null or p.store_id=s)
$$;
create function public.has_sale_push(s uuid, destination text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.sale_push_subscriptions p
    where p.store_id=s and p.user_id=auth.uid() and p.endpoint=destination)
$$;
revoke all on function public.has_sale_push(uuid,text) from public,anon,authenticated;
grant execute on function public.has_sale_push(uuid,text) to authenticated;
create function public.claim_sale_push(s uuid, sale uuid) returns setof jsonb
language plpgsql security definer set search_path='' as $$
declare seller uuid;
begin
  update public.sales set push_claimed=true where id=sale and store_id=s and status='completed' and not push_claimed
    returning operator_id into seller;
  if not found then return; end if;
  return query select p.subscription from private.sale_push_subscriptions p
    join public.members m using(store_id,user_id) join public.stores t on t.id=p.store_id
    where p.store_id=s and m.active and t.status='active'
      and (t.expires_on is null or t.expires_on >= (now() at time zone t.timezone)::date)
      and (p.user_id=seller or m.role='owner' or (m.role='manager' and 'sales'=any(m.permissions)));
end $$;
create function public.remove_expired_sale_push(destination text) returns void
language sql security definer set search_path='' as $$
  delete from private.sale_push_subscriptions where endpoint=destination
$$;
revoke all on function public.register_sale_push(uuid,jsonb), public.unregister_sale_push(text,uuid),
  public.claim_sale_push(uuid,uuid), public.remove_expired_sale_push(text) from public,anon,authenticated;
grant execute on function public.register_sale_push(uuid,jsonb), public.unregister_sale_push(text,uuid) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.claim_sale_push(uuid,uuid), public.remove_expired_sale_push(text) to service_role;
  end if;
end $$;
commit;
