begin;

create table private.product_imports (
  store_id uuid not null references public.stores(id),
  fingerprint bytea not null,
  user_id uuid not null references auth.users(id),
  product_count integer not null,
  created_at timestamptz not null default now(),
  primary key (store_id,fingerprint)
);
alter table private.product_imports enable row level security;
revoke all on private.product_imports from public, anon, authenticated;

create function public.import_products(s uuid, products jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  item_line bigint;
  prior_count integer;
  batch_key bytea;
  batch_count integer;
  duplicate_constraint text;
begin
  perform private.require_access(s,'products');
  if jsonb_typeof(products) is distinct from 'array' then
    raise exception 'Envie uma lista de produtos válida.';
  end if;
  batch_count := jsonb_array_length(products);
  if batch_count not between 1 and 250 or octet_length(products::text)>300000 then
    raise exception 'Envie de 1 a 250 produtos por importação.';
  end if;

  select sha256(convert_to(jsonb_agg(value - 'line' order by ordinality)::text,'UTF8')) into batch_key
  from jsonb_array_elements(products) with ordinality;
  perform pg_advisory_xact_lock(hashtextextended('product-import:'||s::text,0));
  select product_count into prior_count from private.product_imports where store_id=s and fingerprint=batch_key;
  if found then return jsonb_build_object('count',prior_count,'alreadyImported',true); end if;

  for item, item_line in select value, ordinality+1 from jsonb_array_elements(products) with ordinality loop
    if item->>'line' ~ '^[0-9]{1,6}$' then item_line := (item->>'line')::integer; end if;
    if coalesce(length(trim(item->>'name')),0) not between 1 and 120
      or length(coalesce(item->>'sku',''))>64 or length(coalesce(item->>'barcode',''))>64
      or length(coalesce(item->>'category',''))>120
      or coalesce(item->>'cost','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
      or coalesce(item->>'price','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
      or coalesce(item->>'stock','') !~ '^[0-9]{1,11}(\.[0-9]{1,3})?$' then
      raise exception 'Linha %. Revise o nome, os valores e os códigos.',item_line;
    end if;
    begin
      perform public.save_product(s,jsonb_build_object(
        'name',item->>'name','sku',coalesce(nullif(trim(item->>'sku'),''),'IMP-'||replace(gen_random_uuid()::text,'-','')),
        'category',item->>'category','barcode',item->>'barcode','cost',item->>'cost',
        'price',item->>'price','stock',item->>'stock','minimum',0,'unit','un','active',true));
    exception when unique_violation then
      get stacked diagnostics duplicate_constraint = constraint_name;
      if duplicate_constraint = 'products_store_id_barcode_key' then
        raise exception 'Linha %. Esse código de barras já está cadastrado nesta loja.',item_line;
      end if;
      if duplicate_constraint = 'products_store_id_sku_key' then
        raise exception 'Linha %. Esse SKU já está cadastrado nesta loja.',item_line;
      end if;
      raise;
    end;
  end loop;
  insert into private.product_imports(store_id,fingerprint,user_id,product_count)
    values(s,batch_key,auth.uid(),batch_count);
  return jsonb_build_object('count',batch_count,'alreadyImported',false);
end $$;

revoke all on function public.import_products(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.import_products(uuid,jsonb) to authenticated;

commit;
