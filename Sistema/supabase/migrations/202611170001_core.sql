create table public.plans (
  id text primary key, name text not null, user_limit integer not null check (user_limit > 0)
);
insert into public.plans values ('starter','Essencial',5),('pro','Profissional',25);
create table public.stores (
  id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 2 and 120),
  timezone text not null default 'America/Sao_Paulo', status text not null default 'active' check (status in ('active','suspended')),
  plan_id text not null default 'starter' references public.plans, expires_on date, user_limit integer check (user_limit > 0),
  created_at timestamptz not null default now()
);
create table public.platform_admins (user_id uuid primary key references auth.users);
create table public.members (
  store_id uuid references public.stores, user_id uuid references auth.users, name text not null,
  role text not null check (role in ('owner','manager','cashier')), active boolean not null default true,
  permissions text[] not null default '{}', primary key (store_id,user_id)
);
create table public.categories (
  id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores, name text not null,
  unique (store_id,name), unique(store_id,id)
);
create table public.products (
  id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores, name text not null check (trim(name) <> ''),
  sku text not null check (trim(sku) <> ''), barcode text, category_id uuid, image_url text,
  cost numeric(14,2) not null check (cost >= 0), price numeric(14,2) not null check (price >= 0),
  stock numeric(14,3) not null default 0 check (stock >= 0), minimum numeric(14,3) not null default 0 check (minimum >= 0),
  unit text not null default 'un', active boolean not null default true,
  unique(store_id,id), unique(store_id,sku), unique(store_id,barcode),
  foreign key(store_id,category_id) references public.categories(store_id,id)
);
create table public.sales (
  id uuid primary key default gen_random_uuid(), number bigint generated always as identity,
  store_id uuid not null references public.stores, operator_id uuid not null, request_id uuid not null, request_payload jsonb not null,
  created_at timestamptz not null default now(), subtotal numeric(16,2) not null check (subtotal >= 0), discount numeric(16,2) not null check (discount >= 0),
  total numeric(16,2) not null check (total = subtotal-discount and total >= 0),
  payment text not null check (payment in ('cash','pix','debit','credit')),
  status text not null default 'completed' check (status in ('completed','cancelled')),
  unique(store_id,id), unique(store_id,operator_id,request_id),
  foreign key(store_id,operator_id) references public.members(store_id,user_id)
);
create table public.sale_items (
  store_id uuid not null, sale_id uuid not null, product_id uuid not null,
  name text not null, category text not null, quantity numeric(14,3) not null check (quantity > 0),
  price numeric(14,2) not null check (price >= 0), cost numeric(14,2) not null check (cost >= 0),
  primary key(sale_id,product_id), foreign key(store_id,sale_id) references public.sales(store_id,id),
  foreign key(store_id,product_id) references public.products(store_id,id)
);
create table public.cancellations (
  store_id uuid not null, sale_id uuid primary key, user_id uuid not null,
  reason text not null check (trim(reason) <> ''), restocked boolean not null, created_at timestamptz not null default now(),
  foreign key(store_id,sale_id) references public.sales(store_id,id), foreign key(store_id,user_id) references public.members(store_id,user_id)
);
create table public.movements (
  id uuid primary key default gen_random_uuid(), store_id uuid not null, product_id uuid not null, user_id uuid not null, sale_id uuid,
  kind text not null check (kind in ('opening','entry','loss','damage','adjustment','withdrawal','sale','reversal')),
  quantity numeric(14,3) not null check (quantity <> 0), previous numeric(14,3) not null,
  balance numeric(14,3) not null check (balance >= 0 and balance = previous + quantity), reason text,
  created_at timestamptz not null default now(),
  foreign key(store_id,product_id) references public.products(store_id,id), foreign key(store_id,user_id) references public.members(store_id,user_id),
  foreign key(store_id,sale_id) references public.sales(store_id,id)
);
create table public.audit_logs (
  id bigint generated always as identity primary key, store_id uuid not null references public.stores,
  user_id uuid not null references auth.users, action text not null, entity_id uuid,
  details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index sales_store_date on public.sales(store_id,created_at desc);
create index movements_store_date on public.movements(store_id,created_at desc);
create index sale_items_product on public.sale_items(store_id,product_id,sale_id);
create index members_user on public.members(user_id) where active;
create index products_category on public.products(store_id,category_id);

create schema private;
create function private.allowed(s uuid, capability text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.members m join public.stores t on t.id=m.store_id
    where m.store_id=s and m.user_id=auth.uid() and m.active and t.status='active'
    and (t.expires_on is null or t.expires_on >= (now() at time zone t.timezone)::date)
    and (m.role='owner' or capability in ('catalog','sell','own_sales') or
        (m.role='manager' and capability=any(m.permissions))))
$$;
create function private.require_access(s uuid, capability text) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.allowed(s,capability) then raise exception 'Você não tem permissão para esta operação.' using errcode='42501'; end if;
end $$;
create function private.is_master() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.platform_admins where user_id=auth.uid())
$$;

do $$
declare name text;
begin
  foreach name in array array['plans','stores','platform_admins','members','categories','products','sales','sale_items','cancellations','movements','audit_logs'] loop
    execute format('alter table public.%I enable row level security',name);
    execute format('revoke all on public.%I from anon, authenticated',name);
  end loop;
end $$;
create policy store_isolation on public.stores for select using (private.allowed(id,'catalog'));
create policy members_isolation on public.members for select using (user_id=auth.uid() or private.allowed(store_id,'staff'));
create policy categories_isolation on public.categories for select using (private.allowed(store_id,'catalog'));
create policy products_isolation on public.products for select using (private.allowed(store_id,'catalog'));
create policy sales_isolation on public.sales for select using (private.allowed(store_id,'sales') or (operator_id=auth.uid() and private.allowed(store_id,'own_sales')));
create policy items_isolation on public.sale_items for select using (exists(select 1 from public.sales where id=sale_id));
create policy cancellations_isolation on public.cancellations for select using (exists(select 1 from public.sales where id=sale_id));
create policy movements_isolation on public.movements for select using (private.allowed(store_id,'stock'));
create policy audit_isolation on public.audit_logs for select using (private.allowed(store_id,'audit'));
grant usage on schema private to authenticated;
grant select on public.stores, public.categories, public.cancellations, public.movements to authenticated;
grant select (store_id,user_id,name,role,permissions,active) on public.members to authenticated;
grant select (id,store_id,name,sku,barcode,category_id,image_url,price,stock,minimum,unit,active) on public.products to authenticated;
grant select (id,number,store_id,operator_id,created_at,subtotal,discount,total,payment,status) on public.sales to authenticated;
grant select (store_id,sale_id,product_id,name,category,quantity,price) on public.sale_items to authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.allowed(uuid,text) to authenticated;

create function private.move(s uuid, p uuid, delta numeric, operation text, why text, sale uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare old numeric;
begin
  select stock into old from public.products where id=p and store_id=s for update;
  if not found then raise exception 'Produto não encontrado.'; end if;
  if delta is null or delta=0 or delta<>round(delta,3) then raise exception 'Informe uma quantidade válida com até três casas decimais.'; end if;
  if old+delta<0 then raise exception 'Estoque insuficiente.'; end if;
  update public.products set stock=old+delta where id=p and store_id=s;
  insert into public.movements(store_id,product_id,user_id,sale_id,kind,quantity,previous,balance,reason)
    values(s,p,auth.uid(),sale,operation,delta,old,old+delta,why);
end $$;

create function public.store_context() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('master',private.is_master(),'stores',coalesce((
    select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'role',m.role,'permissions',m.permissions,'timezone',s.timezone,
      'available', private.allowed(s.id,'catalog')) order by s.name)
    from public.members m join public.stores s on s.id=m.store_id where m.user_id=auth.uid() and m.active),'[]'))
$$;
create function public.create_store(store_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare s uuid;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória.'; end if;
  insert into public.stores(name) values(trim(store_name)) returning id into s;
  insert into public.members values(s,auth.uid(),coalesce(auth.jwt()->>'email','Proprietário'),'owner',true,'{}');
  insert into public.audit_logs(store_id,user_id,action,entity_id) values(s,auth.uid(),'store_created',s);
  return s;
end $$;

create function public.product_catalog(s uuid, q text default '', selected_category uuid default null, page_number integer default 0, page_size integer default 40, only_active boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_access(s,'catalog');
  return coalesce((select jsonb_agg(to_jsonb(p) - case when private.allowed(s,'products') or private.allowed(s,'reports') then '' else 'cost' end)
    from (select p.*, c.name as category from public.products p left join public.categories c on c.id=p.category_id
      where p.store_id=s and (not only_active or p.active) and (p.active or private.allowed(s,'products') or private.allowed(s,'stock') or private.allowed(s,'reports'))
        and (selected_category is null or p.category_id=selected_category)
        and (q='' or position(lower(q) in lower(p.name))>0 or position(lower(q) in lower(p.sku))>0 or p.barcode=q)
      order by (q<>'' and p.barcode=q) desc nulls last, (q<>'' and lower(p.sku)=lower(q)) desc, p.name,p.id limit greatest(1,least(page_size,101)) offset greatest(0,page_number)*greatest(1,least(page_size,101))) p),'[]');
end $$;

create function public.product_by_id(s uuid, p uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_access(s,'catalog');
  return (select (to_jsonb(item)||jsonb_build_object('category',c.name)) -
      case when private.allowed(s,'products') or private.allowed(s,'reports') then '' else 'cost' end
    from public.products item left join public.categories c on c.id=item.category_id
    where item.store_id=s and item.id=p and (item.active or private.allowed(s,'products') or private.allowed(s,'stock') or private.allowed(s,'reports')));
end $$;

create function public.save_product(s uuid, data jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare p uuid := nullif(data->>'id','')::uuid; c uuid; category_name text:=trim(data->>'category'); opening numeric:=coalesce((data->>'stock')::numeric,0);
begin
  perform private.require_access(s,'products');
  if opening<0 then raise exception 'O estoque inicial não pode ser negativo.'; end if;
  if category_name<>'' then
    insert into public.categories(store_id,name) values(s,category_name)
      on conflict(store_id,name) do update set name=excluded.name returning id into c;
  end if;
  if p is null then
    insert into public.products(store_id,name,sku,barcode,category_id,image_url,cost,price,minimum,unit,active)
    values(s,trim(data->>'name'),trim(data->>'sku'),nullif(trim(data->>'barcode'),''),c,nullif(trim(data->>'image_url'),''),
      (data->>'cost')::numeric,(data->>'price')::numeric,(data->>'minimum')::numeric,trim(data->>'unit'),(data->>'active')::boolean) returning id into p;
    if opening>0 then perform private.move(s,p,opening,'opening','Estoque inicial'); end if;
  else
    update public.products set name=trim(data->>'name'),sku=trim(data->>'sku'),barcode=nullif(trim(data->>'barcode'),''),
      category_id=c,image_url=nullif(trim(data->>'image_url'),''),cost=(data->>'cost')::numeric,price=(data->>'price')::numeric,
      minimum=(data->>'minimum')::numeric,unit=trim(data->>'unit'),active=(data->>'active')::boolean where id=p and store_id=s;
    if not found then raise exception 'Produto não encontrado.'; end if;
  end if;
  insert into public.audit_logs(store_id,user_id,action,entity_id) values(s,auth.uid(),'product_saved',p);
  return p;
end $$;
create function public.adjust_stock(s uuid, p uuid, amount numeric, operation text, reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_access(s,'stock');
  if operation is null or operation not in ('entry','loss','damage','adjustment','withdrawal') or amount is null or amount=0
   or (operation<>'adjustment' and amount<0) or (operation<>'entry' and coalesce(trim(reason),'')='') then
    raise exception 'Informe uma quantidade válida e o motivo da movimentação.';
  end if;
  perform private.move(s,p,case when operation in ('loss','damage','withdrawal') then -amount else amount end,operation,trim(reason));
end $$;

create function public.finish_sale(s uuid, request_key uuid, items jsonb, rebate numeric, payment_method text) returns jsonb
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
  return jsonb_build_object('id',current_sale.id,'number',current_sale.number,'total',current_sale.total,'status',current_sale.status);
end $$;

create function public.cancel_sale(s uuid, sale uuid, why text, restore_stock boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare old_status text; item record;
begin
  perform private.require_access(s,'cancel');
  if coalesce(trim(why),'')='' or restore_stock is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  select status into old_status from public.sales where id=sale and store_id=s for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if old_status='cancelled' then return; end if;
  insert into public.cancellations(store_id,sale_id,user_id,reason,restocked) values(s,sale,auth.uid(),trim(why),restore_stock);
  if restore_stock then
    for item in select product_id,quantity from public.sale_items where sale_id=sale and store_id=s order by product_id loop
      perform private.move(s,item.product_id,item.quantity,'reversal',trim(why),sale);
    end loop;
  end if;
  update public.sales set status='cancelled' where id=sale and store_id=s;
end $$;

create function public.manage_member(s uuid, email_address text, display_name text, member_role text, enabled boolean, capabilities text[]) returns void
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
    case when member_role='manager' then array(select x from unnest(capabilities) x where x in ('products','stock','sales','reports','cancel')) else '{}' end)
  on conflict(store_id,user_id) do update set name=excluded.name,role=excluded.role,active=excluded.active,permissions=excluded.permissions;
  insert into public.audit_logs(store_id,user_id,action,entity_id,details) values(s,auth.uid(),'member_saved',member_id,jsonb_build_object('active',enabled,'role',member_role));
end $$;
create function public.member_list(s uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_access(s,'staff');
  return coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('email',u.email) order by m.name)
    from public.members m join auth.users u on u.id=m.user_id where m.store_id=s),'[]');
end $$;
create function public.save_store(s uuid, store_name text, zone text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_access(s,'settings');
  if zone is null or not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'Fuso horário inválido.'; end if;
  update public.stores set name=trim(store_name),timezone=zone where id=s;
  insert into public.audit_logs(store_id,user_id,action,entity_id) values(s,auth.uid(),'store_saved',s);
end $$;
create function public.master_list() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_master() then raise exception 'Acesso restrito.' using errcode='42501'; end if;
  return jsonb_build_object('stores',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from public.stores t),'[]'),
    'plans',(select jsonb_agg(to_jsonb(p) order by p.user_limit) from public.plans p));
end $$;
create function public.master_save(s uuid, company text, plan text, state text, expiry date, seats integer, owner_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid; owner_id uuid;
begin
  if not private.is_master() then raise exception 'Acesso restrito.' using errcode='42501'; end if;
  if s is null then
    select id into owner_id from auth.users where lower(email)=lower(trim(owner_email)) and email_confirmed_at is not null;
    if owner_id is null then raise exception 'O proprietário precisa de uma conta com e-mail confirmado.'; end if;
    insert into public.stores(name,plan_id,status,expires_on,user_limit) values(trim(company),plan,state,expiry,seats) returning id into result;
    insert into public.members values(result,owner_id,owner_email,'owner',true,'{}');
  else
    update public.stores set name=trim(company),plan_id=plan,status=state,expires_on=expiry,user_limit=seats where id=s returning id into result;
    if not found then raise exception 'Empresa não encontrada.'; end if;
  end if;
  insert into public.audit_logs(store_id,user_id,action,entity_id,details) values(result,auth.uid(),'subscription_saved',result,jsonb_build_object('status',state,'plan',plan,'expires_on',expiry));
  return result;
end $$;

create function public.sales_history(s uuid, start_date date, end_date date, product_query text, operator_query text, payment_filter text, status_filter text, page_number integer, sale_filter uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare zone text;
begin
  perform private.require_access(s,'own_sales');
  select timezone into zone from public.stores where id=s;
  return coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
    select a.id,a.number,a.operator_id,a.created_at,a.subtotal,a.discount,a.total,a.payment,a.status,m.name as operator,
      (select jsonb_agg(jsonb_build_object('name',i.name,'quantity',i.quantity,'price',i.price) order by i.name) from public.sale_items i where i.sale_id=a.id) as items,
      (select jsonb_build_object('created_at',c.created_at,'reason',c.reason,'restocked',c.restocked,'operator',cm.name)
        from public.cancellations c join public.members cm on cm.store_id=c.store_id and cm.user_id=c.user_id where c.sale_id=a.id) as cancellation
    from public.sales a join public.members m on m.store_id=a.store_id and m.user_id=a.operator_id
    where a.store_id=s and (a.operator_id=auth.uid() or private.allowed(s,'sales')) and (sale_filter is null or a.id=sale_filter)
      and (start_date is null or a.created_at>=start_date::timestamp at time zone zone)
      and (end_date is null or a.created_at<(end_date+1)::timestamp at time zone zone)
      and (payment_filter='' or a.payment=payment_filter) and (status_filter='' or a.status=status_filter)
      and (operator_query='' or position(lower(operator_query) in lower(m.name))>0)
      and (product_query='' or exists(select 1 from public.sale_items i where i.sale_id=a.id and position(lower(product_query) in lower(i.name))>0))
    order by a.created_at desc,a.id desc limit 31 offset greatest(0,page_number)*30
  ) h),'[]');
end $$;

create function public.stock_history(s uuid, start_date date, end_date date, q text, page_number integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare zone text;
begin
  if not (private.allowed(s,'stock') or private.allowed(s,'reports')) then perform private.require_access(s,'stock'); end if;
  select timezone into zone from public.stores where id=s;
  return coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc) from (
    select v.*,p.name as product,m.name as operator from public.movements v
    join public.products p on p.id=v.product_id join public.members m on m.store_id=v.store_id and m.user_id=v.user_id
    where v.store_id=s and (start_date is null or v.created_at>=start_date::timestamp at time zone zone)
      and (end_date is null or v.created_at<(end_date+1)::timestamp at time zone zone)
      and (q='' or position(lower(q) in lower(p.name))>0 or position(lower(q) in lower(p.sku))>0)
    order by v.created_at desc,v.id desc limit 31 offset greatest(0,page_number)*30
  ) h),'[]');
end $$;

create function public.store_report(s uuid, from_day date, to_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare zone text; today date; this_month date; result jsonb;
begin
  perform private.require_access(s,'reports');
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

revoke all on function private.move(uuid,uuid,numeric,text,text,uuid) from public, anon, authenticated;
do $$
declare entry record;
begin
  for entry in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('store_context','create_store','product_catalog','product_by_id','save_product','adjust_stock','finish_sale','cancel_sale',
    'manage_member','member_list','save_store','master_list','master_save','sales_history','stock_history','store_report') loop
    execute format('revoke all on function %s from public, anon, authenticated',entry.signature);
    execute format('grant execute on function %s to authenticated',entry.signature);
  end loop;
end $$;
