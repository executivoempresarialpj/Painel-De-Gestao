begin;
alter table public.sales add column if not exists customer_name text, add column if not exists sale_day date;
create or replace function public.reset_target(address text) returns uuid language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_master() then raise exception 'Acesso restrito.'; end if;
 return (select u.id from auth.users u where lower(u.email)=lower(trim(address)) and not exists(select 1 from public.platform_admins a where a.user_id=u.id));
end $$;
revoke all on function public.reset_target(text) from public,anon;
grant execute on function public.reset_target(text) to authenticated;
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
  return jsonb_build_object('id',current_sale.id,'number',current_sale.number,'total',current_sale.total,'status',current_sale.status);
end $$;
revoke all on function public.record_sale(uuid,uuid,jsonb,numeric,text,text,date) from public,anon;
grant execute on function public.record_sale(uuid,uuid,jsonb,numeric,text,text,date) to authenticated;
create or replace function public.sales_history(s uuid, start_date date, end_date date, product_query text, operator_query text, payment_filter text, status_filter text, page_number integer, sale_filter uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare zone text;
begin
  perform private.require_access(s,'own_sales');
  select timezone into zone from public.stores where id=s;
  return coalesce((select jsonb_agg(to_jsonb(h) order by h.sale_day desc,h.created_at desc,h.id desc) from (
    select a.id,a.number,a.operator_id,a.customer_name,coalesce(a.sale_day,(a.created_at at time zone zone)::date) as sale_day,a.created_at,a.subtotal,a.discount,a.total,a.payment,a.status,m.name as operator,
      (select jsonb_agg(jsonb_build_object('name',i.name,'quantity',i.quantity,'price',i.price) order by i.name) from public.sale_items i where i.sale_id=a.id) as items,
      (select jsonb_build_object('created_at',c.created_at,'reason',c.reason,'restocked',c.restocked,'operator',cm.name)
        from public.cancellations c join public.members cm on cm.store_id=c.store_id and cm.user_id=c.user_id where c.sale_id=a.id) as cancellation
    from public.sales a join public.members m on m.store_id=a.store_id and m.user_id=a.operator_id
    where a.store_id=s and (a.operator_id=auth.uid() or private.allowed(s,'sales')) and (sale_filter is null or a.id=sale_filter)
      and (start_date is null or coalesce(a.sale_day,(a.created_at at time zone zone)::date)>=start_date)
      and (end_date is null or coalesce(a.sale_day,(a.created_at at time zone zone)::date)<=end_date)
      and (payment_filter='' or a.payment=payment_filter) and (status_filter='' or a.status=status_filter)
      and (operator_query='' or position(lower(operator_query) in lower(m.name))>0)
      and (product_query='' or exists(select 1 from public.sale_items i where i.sale_id=a.id and position(lower(product_query) in lower(i.name))>0))
    order by coalesce(a.sale_day,(a.created_at at time zone zone)::date) desc,a.created_at desc,a.id desc limit 31 offset greatest(0,page_number)*30
  ) h),'[]');
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
create or replace function public.administered_auth_email(event jsonb) returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Solicite acesso ou nova senha ao gestor.'));
$$;
revoke all on function public.administered_auth_email(jsonb) from public,anon,authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='supabase_auth_admin') then
 grant execute on function public.administered_auth_email(jsonb) to supabase_auth_admin;
end if; end $$;
commit;
