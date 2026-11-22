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
  ), item_weights as (
    select i.*,a.subtotal,a.discount,a.ice_cost,
      round(i.quantity*i.price,2) as line_value,
      case when a.ice_cost=0 then 0
        when private.catalog_key(i.name) ~ '^baldao (de )?(whisky|whiskey|hisky|uisque)( |$)' then i.quantity*3
        when private.catalog_key(i.name) ~ '^copao( |$)' then i.quantity
        else 0 end as ice_weight
    from public.sale_items i join selected a on a.id=i.sale_id and a.store_id=i.store_id
  ), item_running as (
    select *,
      sum(line_value) over(partition by sale_id order by product_id) as running,
      sum(ice_weight) over(partition by sale_id order by product_id) as ice_running,
      sum(ice_weight) over(partition by sale_id) as ice_units
    from item_weights
  ), selected_items as (
    select *, coalesce(
      round(ice_cost*ice_running/nullif(ice_units,0),2)-
      round(ice_cost*(ice_running-ice_weight)/nullif(ice_units,0),2),0) as line_ice_cost
    from item_running
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
      'last_24h_profit',coalesce(sum(total-ice_cost) filter(where created_at between now()-interval '24 hours' and now()),0)-
        coalesce((select sum(round(i.quantity*i.cost,2)) from public.sale_items i join completed a on a.id=i.sale_id where a.created_at between now()-interval '24 hours' and now()),0),
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
        +round(coalesce(discount*(running-line_value)/nullif(subtotal,0),0),2)-round(cost*quantity,2)-line_ice_cost) as profit,sum(round(cost*quantity,2)+line_ice_cost) as cost
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
