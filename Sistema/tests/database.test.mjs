import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { PGlite } from "@electric-sql/pglite"
import pg from "pg"

const migration = await readFile(new URL("../supabase/migrations/202611170001_core.sql", import.meta.url), "utf8")
let db, store, otherStore, perfume, last
const owner = randomUUID()
const cashier = randomUUID()
const outsider = randomUUID()
const master = randomUUID()
const firstSale = randomUUID()
const postgres = process.env.VAREJO_TEST_POSTGRES
let admin, pool, temporaryDatabase
async function connect() {
  if (!postgres) return new PGlite()
  admin=new pg.Client({connectionString:postgres})
  await admin.connect()
  temporaryDatabase="varejo_test_"+randomUUID().replaceAll("-","")
  await admin.query("create database "+temporaryDatabase)
  const url=new URL(postgres)
  url.pathname="/"+temporaryDatabase
  pool=new pg.Pool({connectionString:url.toString()})
  return {
    query: (sql,args) => pool.query(sql,args),
    exec: sql => pool.query(sql),
    async transaction(fn) {
      const client=await pool.connect()
      try {
        await client.query("begin")
        const result=await fn({query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql)})
        await client.query("commit")
        return result
      } catch(error) { await client.query("rollback"); throw error }
      finally { client.release() }
    },
    async close() {
      await pool.end()
      await admin.query("drop database "+temporaryDatabase)
      await admin.end()
    }
  }
}
const product = (name, stock, cost = 60) => ({name,sku:name,category:"Perfumaria",stock,cost,price:100,minimum:2,unit:"un",active:true})

async function as(user, fn) {
  return db.transaction(async transaction => {
    await transaction.exec("set local role authenticated")
    await transaction.query("select set_config('request.jwt.claim.sub',$1,true)",[user])
    const run = async (sql, params=[]) => (await transaction.query(sql,params)).rows
    return fn(run)
  })
}
async function scalar(run,sql,params=[]) { return (await run(sql,params))[0].result }
function sell(run, target, key, id, quantity) {
  return scalar(run,"select public.finish_sale($1,$2,$3,0,'cash') as result",[target,key,JSON.stringify([{id,quantity}])])
}
function state(run, id, target=store) {
  return scalar(run,"select public.product_by_id($1,$2) as result",[target,id])
}
before(async()=>{
  db = await connect()
  await db.exec(`
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    end $$;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('email',email) from auth.users where id=auth.uid()$$;
    grant usage on schema auth to authenticated;
  `)
  await db.exec(migration)
  await db.exec(await readFile(new URL("../supabase/migrations/202611180001_product_import.sql", import.meta.url), "utf8"))
  for(const [id,name] of [[owner,"owner"],[outsider,"outsider"],[cashier,"cashier"],[master,"master"]]) {
    await db.query("insert into auth.users values($1,$2,now())",[id,name+"@example.com"])
  }
  await db.query("insert into platform_admins values($1)",[master])
  store = await as(owner,run=>scalar(run,"select public.create_store('Loja A') as result"))
  otherStore = await as(outsider,run=>scalar(run,"select public.create_store('Loja B') as result"))
  perfume = await as(owner,run=>scalar(run,"select public.save_product($1,$2) as result",[store,JSON.stringify(product("PERFUME",50))]))
  last = await as(owner,run=>scalar(run,"select public.save_product($1,$2) as result",[store,JSON.stringify(product("Última unidade",1))]))
  await as(owner,run=>run("select public.manage_member($1,'cashier@example.com','Caixa','cashier',true,'{}')",[store]))
  await db.exec(await readFile(new URL("../supabase/migrations/202611180002_executivo.sql",import.meta.url),"utf8"))
  await db.exec(await readFile(new URL("../supabase/migrations/202611180003_painel.sql",import.meta.url),"utf8"))
  await db.exec(await readFile(new URL("../supabase/migrations/202611180004_clientes.sql",import.meta.url),"utf8"))
  await db.exec(await readFile(new URL("../supabase/migrations/202611180005_servicos.sql",import.meta.url),"utf8"))
  await db.exec(await readFile(new URL("../supabase/migrations/202611180006_gestao.sql",import.meta.url),"utf8"))
  await db.exec(await readFile(new URL("../supabase/migrations/202611210001_sales_updates.sql",import.meta.url),"utf8"))
  await db.exec(await readFile(new URL("../supabase/migrations/202611220001_profit_24h.sql",import.meta.url),"utf8"))
  await db.exec(await readFile(new URL("../supabase/migrations/202611220002_baldao_custo_incluso.sql",import.meta.url),"utf8"))
  await db.exec(await readFile(new URL("../supabase/migrations/202611220003_combo_cost_included.sql",import.meta.url),"utf8"))
  for(const email of ["owner","outsider","cashier"]) await as(master,run=>run("select public.set_account_access($1,true)",[email+"@example.com"]))

})
after(async()=>{await db?.close()})

test("PERFUME: venda, idempotência, baixa, faturamento e custo histórico",async()=>{
  const [sale, replay]=await Promise.all([
    as(cashier,run=>sell(run,store,firstSale,perfume,3)),
    as(cashier,run=>sell(run,store,firstSale,perfume,3))
  ])
  assert.equal(sale.total,300)
  assert.deepEqual(replay,sale)
  assert.deepEqual(await as(cashier,run=>sell(run,store,firstSale,perfume,3)),sale)
  await assert.rejects(as(cashier,run=>sell(run,store,firstSale,perfume,2)),/chave já pertence/)
  await as(owner,async run=>{
    assert.equal((await state(run,perfume)).stock,47)
    const movements=await scalar(run,"select public.stock_history($1,null,null,'PERFUME',0) as result",[store])
    assert.deepEqual(movements.map(x=>[x.kind,x.quantity,x.balance]),[["sale",-3,47],["opening",50,50]])
    await run("select public.save_product($1,$2)",[store,JSON.stringify({...product("PERFUME",0,90),id:perfume})])
    const {metrics,ranking}=await scalar(run,"select public.store_report($1,(now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date) as result",[store])
    assert.equal(metrics.today_sales,1)
    assert.equal(metrics.today_revenue,300)
    assert.equal(metrics.month_profit,120)
    assert.equal(ranking[0].profit,120)
    assert.equal(ranking[0].quantity,3)
  })
})

test("estoque insuficiente reverte a venda inteira",async()=>{
  await assert.rejects(as(cashier,run=>scalar(run,"select public.finish_sale($1,$2,$3,0,'cash') as result",[
    store,randomUUID(),JSON.stringify([{id:last,quantity:1},{id:perfume,quantity:48}])
  ])),/Estoque insuficiente/)
  await as(owner,async run=>{
    assert.equal((await state(run,last)).stock,1)
    assert.equal((await state(run,perfume)).stock,47)
  })
})

test("duas tentativas para a última unidade têm um único sucesso",async()=>{
  const attempts=await Promise.allSettled([
    as(owner,run=>sell(run,store,randomUUID(),last,1)),
    as(cashier,run=>sell(run,store,randomUUID(),last,1))
  ])
  assert.equal(attempts.filter(attempt=>attempt.status==="fulfilled").length,1)
  assert.match(attempts.find(attempt=>attempt.status==="rejected").reason.message,/Estoque insuficiente/)
  assert.equal((await as(owner,run=>state(run,last))).stock,0)
})

test("caixa não vê custos nem opera funções gerenciais; loja B não lê loja A",async()=>{
  assert.equal(Object.hasOwn(await as(cashier,run=>state(run,perfume)),"cost"),false)
  await assert.rejects(as(cashier,run=>run("select cost from public.products")),/permission denied/)
  await assert.rejects(as(cashier,run=>run("select public.adjust_stock($1,$2,1,'entry','')",[store,perfume])),/permissão/)
  await assert.rejects(as(cashier,run=>run("select public.store_report($1,current_date,current_date)",[store])),/permissão/)
  await assert.rejects(as(cashier,run=>run("select public.master_list()")),/restrito/)
  await assert.rejects(as(outsider,run=>state(run,perfume)),/permissão/)
  await as(outsider,async run=>{
    assert.equal(await state(run,perfume,otherStore),null)
    assert.deepEqual(await run("select id from public.products where store_id=$1",[store]),[])
    assert.deepEqual(await run("select id from public.sales where store_id=$1",[store]),[])
    assert.deepEqual(await run("select product_id from public.sale_items where store_id=$1",[store]),[])
  })
  await as(cashier,async run=>{
    const sales=await scalar(run,"select public.sales_history($1,null,null,'PERFUME','','','',0) as result",[store])
    assert.equal(sales.length,1)
    assert.equal(sales[0].items[0].name,"PERFUME")
  })
})

test("cancelamento com estorno mantém histórico e não estorna duas vezes",async()=>{
  const sale=await as(cashier,run=>sell(run,store,firstSale,perfume,3))
  await assert.rejects(as(cashier,run=>run("select public.cancel_sale($1,$2,'Devolução',true)",[store,sale.id])),/permissão/)
  await assert.rejects(as(owner,run=>run("select public.cancel_sale($1,$2,'',true)",[store,sale.id])),/motivo/)
  const cancel=()=>as(owner,run=>run("select public.cancel_sale($1,$2,'Devolução integral',true)",[store,sale.id]))
  await Promise.all([cancel(),cancel()])
  await as(owner,async run=>{
    assert.equal((await state(run,perfume)).stock,50)
    const {metrics,ranking}=await scalar(run,"select public.store_report($1,(now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date) as result",[store])
    assert.equal(metrics.today_sales,1)
    assert.equal(metrics.today_revenue,100)
    assert.equal(ranking.some(row=>row.product_id===perfume),false)
    const history=await scalar(run,"select public.sales_history($1,null,null,'','','','',0,$2) as result",[store,sale.id])
    assert.equal(history[0].status,"cancelled")
    assert.equal(history[0].total,300)
    assert.equal(history[0].cancellation.reason,"Devolução integral")
  })
})

test("suspensão protege dados e operações sem remover vínculos",async()=>{
  await as(master,run=>run("select public.master_save($1,'Loja B','pro','suspended',null,2,null)",[otherStore]))
  await assert.rejects(as(outsider,run=>state(run,perfume,otherStore)),/permissão/)
  await as(outsider,async run=>{
    const context=await scalar(run,"select public.store_context() as result")
    assert.equal(context.stores[0].available,false)
    assert.equal(context.master,false)
  })
})

test("entrada, perda e venda com desconto atualizam os indicadores",async()=>{
  await as(owner,async run=>{
    const p=await scalar(run,"select public.save_product($1,$2) as result",[store,JSON.stringify(product("Amostra",0,20))])
    await run("select public.adjust_stock($1,$2,5,'entry','Reposição')",[store,p])
    await run("select public.adjust_stock($1,$2,1,'damage','Frasco quebrado')",[store,p])
    const sale=await scalar(run,"select public.finish_sale($1,$2,$3,15.25,'pix') as result",[store,randomUUID(),JSON.stringify([{id:p,quantity:1.25}])])
    assert.equal(sale.total,109.75)
    assert.equal((await state(run,p)).stock,2.75)
    const data=await scalar(run,"select public.store_report($1,(now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date) as result",[store])
    assert.deepEqual(data.payments.find(row=>row.name==="pix"),{sales:1,revenue:109.75,name:"pix"})
    assert.equal(data.metrics.period_profit,124.75)
  })
})

test("importação registra abertura, evita replay e reverte todo o lote em caso de conflito",async()=>{
  const imported=(name,sku,line)=>({line,name,sku,cost:"12.50",price:"25.90",stock:"7",category:"Importados",barcode:""})
  const runImport=(user,company,rows)=>as(user,run=>scalar(run,"select public.import_products($1,$2) as result",[company,JSON.stringify(rows)]))
  const rows=[imported("Importado A","IMP-A",2),imported("Importado B","",3)]
  await assert.rejects(runImport(cashier,store,rows),/permissão/)
  await assert.rejects(runImport(outsider,store,rows),/permissão/)
  assert.deepEqual(await runImport(owner,store,rows),{count:2,alreadyImported:false})
  assert.deepEqual(await runImport(owner,store,rows),{count:2,alreadyImported:true})
  await assert.rejects(runImport(owner,store,[imported("Importado C","IMP-C",2),imported("Conflito","IMP-A",3)]),/Linha 3.*SKU/)
  await as(owner,async run=>{
    const products=await scalar(run,"select public.product_catalog($1,'Importado') as result",[store])
    assert.equal(products.length,2)
    assert.equal(products[0].stock,7)
    assert.equal(products[0].cost,12.5)
    assert.match(products[1].sku,/^IMP-/)
    const movements=await scalar(run,"select public.stock_history($1,null,null,'Importado',0) as result",[store])
    assert.deepEqual(movements.map(row=>[row.kind,row.quantity]),[["opening",7],["opening",7]])
  })
})

test("gestor autoriza, bloqueia sessões e controla novas empresas", async()=>{
  await assert.rejects(as(owner,run=>run("select public.create_store('Outra empresa')")),/permission denied/)
  await assert.rejects(as(cashier,run=>run("select public.set_account_access('cashier@example.com',true)")),/restrito/)
  await as(master,run=>run("select public.set_account_access('cashier@example.com',false)"))
  await assert.rejects(as(cashier,run=>state(run,perfume)),/permissão/)
  await as(cashier,async run=>{assert.deepEqual((await scalar(run,"select public.store_context() as result")).stores,[])})
  await as(master,run=>run("select public.set_account_access('cashier@example.com',true)"))
  await as(cashier,run=>run("select public.store_context()"))
  const usage=await as(master,run=>scalar(run,"select public.master_list() as result"))
  assert.ok(usage.recent>=1)
})

test("planilha de entrada soma estoque uma vez e reverte lote inválido",async()=>{
 const receive=(ref,lines)=>as(owner,run=>scalar(run,"select public.receive_sheet($1,$2,$3) as result",[store,ref,JSON.stringify(lines)]))
 const before=(await as(owner,run=>state(run,perfume))).stock
 const lines=[{sku:"PERFUME",quantity:"4"}]
 assert.equal(await receive("nota-1",lines),1)
 assert.equal(await receive("nota-1",lines),0)
 await assert.rejects(receive("nota-2",[...lines,{sku:"zz-ausente",quantity:"1"}]),/indisponível/)
 assert.equal((await as(owner,run=>state(run,perfume))).stock,before+4)
})

test("permissões independentes de painel e relatórios no banco",async()=>{
 for(const [granted,denied] of [["executive","reports"],["reports","executive"]]){
   await as(owner,r=>r("select public.manage_member($1,'cashier@example.com','Gerente','manager',true,$2)",[store,[granted]]))
   const report=cap=>"select public."+({executive:"executive_report",reports:"store_report"}[cap])+"($1,current_date,current_date)"
   await as(cashier,r=>r(report(granted),[store]))
   await assert.rejects(as(cashier,r=>r(report(denied),[store])),/permissão/)
 }
})
test("cada pessoa verifica esgotamento uma vez por ocorrência",async()=>{
 const id=await as(owner,r=>scalar(r,"select public.save_product($1,$2) as result",[store,JSON.stringify(product("Avisos",1))]))
 const review=user=>as(user,r=>scalar(r,"select public.stock_notifications($1,true) as result",[store]))
 await as(owner,r=>sell(r,store,randomUUID(),id,1))
 assert.ok((await review(owner)).items.some(x=>x.id===id))
 assert.ok(!(await review(owner)).items.some(x=>x.id===id))
 assert.ok((await review(cashier)).items.some(x=>x.id===id))
 await assert.rejects(review(outsider),/permissão/)
 await as(owner,r=>r("select public.adjust_stock($1,$2,1,'entry','Reposição')",[store,id]))
 await as(owner,r=>sell(r,store,randomUUID(),id,1))
 assert.ok((await review(owner)).items.some(x=>x.id===id))
})
test("somente gestor altera identificação empresarial",async()=>{
 const plan=(await db.query("select plan_id from public.stores where id=$1",[store])).rows[0].plan_id
 const save=r=>r("select public.save_client($1,'Loja A',$2,'active',null,null,null,'Ana')",[store,plan])
 await assert.rejects(as(owner,save))
 await as(master,save)
 await assert.rejects(as(owner,r=>r("select public.company_audit($1)",[store])),/restrito/)
 assert.ok((await as(master,r=>scalar(r,"select public.company_audit($1) as result",[store]))).some(event=>event.action==="subscription_saved"))
 const context=await as(owner,r=>scalar(r,"select public.store_context() as result"))
 assert.equal(context.stores.find(x=>x.id===store).displayName,"Ana")
 assert.equal(await as(owner,r=>scalar(r,"select public.manager_access() as result")),false)
 assert.equal(await as(master,r=>scalar(r,"select public.manager_access() as result")),true)
})
test("venda datada com cliente e desconto concilia o lucro por produto",async()=>{
 await as(owner,async r=>{
 const ids=[]
 for(const name of ["Rateio A","Rateio B"])ids.push(await scalar(r,"select public.save_product($1,$2) as result",[store,JSON.stringify(product(name,5))]))
 const args=[store,randomUUID(),JSON.stringify(ids.map(id=>({id,quantity:1}))),"2001-01-02"]
 const sql="select public.record_sale($1,$2,$3,0.01,'cash','Ana',$4) as result"
 const sale=await scalar(r,sql,args)
 assert.deepEqual(await scalar(r,sql,args),sale)
 const history=await scalar(r,"select public.sales_history($1,$2,$2,'','','','',0) as result",[store,args[3]])
 assert.equal(history[0].customer_name,"Ana")
 const report=await scalar(r,"select public.store_report($1,$2,$2) as result",[store,args[3]])
 assert.equal(report.metrics.period_profit,79.99)
 assert.equal(report.ranking.reduce((sum,row)=>sum+Math.round(row.profit*100),0),7999)
 })
 await assert.rejects(as(cashier,r=>r("select public.reset_target('owner@example.com')")),/restrito/)
})
test("empresa de serviços separa receita e insumos e permite revogar e excluir",async()=>{
 const s=await as(master,r=>scalar(r,"select public.configure_company(null,'Estética','starter','active',null,null,'owner@example.com','Ana','services',null) as result"))
 const k=randomUUID()
 await as(owner,async r=>{
   await r("select public.add_job($1,$2,'Lavagem','Ana',89.90,current_date-1)",[s,k])
   await r("select public.add_job($1,$2,'Lavagem','Ana',89.90,current_date-1)",[s,k])
   const report=await scalar(r,"select public.jobs_view($1,current_date-1,current_date) as result",[s])
   assert.equal(report.count,1);assert.equal(report.revenue,89.9)
 })
 const id=await as(owner,r=>scalar(r,"select public.save_product($1,$2) as result",[s,JSON.stringify(product("Cera",2))]))
 await assert.rejects(as(owner,r=>sell(r,s,randomUUID(),id,1)),/serviços/)
 await assert.rejects(as(owner,r=>r("select public.manage_company_access($1,'','Estética',true)",[s])),/restrito/)
 await as(master,r=>r("select public.manage_company_access($1,'owner@example.com','',false)",[s]))
 await assert.rejects(as(owner,r=>r("select public.jobs_view($1,current_date,current_date)",[s])),/permissão/)
 await as(master,r=>r("select public.manage_company_access($1,'','Estética',true)",[s]))
 assert.equal((await db.query("select * from public.stores where id=$1",[s])).rows.length,0)
})

test("serviços somam custos, respeitam filtros e excluem cancelados do resultado",async()=>{
 const s=await as(master,r=>scalar(r,"select public.configure_company(null,'Prestadora','starter','active',null,null,'owner@example.com','Ana','services',null) as result"))
 const id=randomUUID()
 await as(owner,async r=>{
   await r("select public.record_job($1,$2,'Consultoria','Ana',180,current_date-1,50,'pix')",[s,id])
   await r("select public.record_job($1,$2,'Consultoria','Ana',180,current_date-1,50,'pix')",[s,id])
   const report=()=>scalar(r,"select public.service_overview($1,current_date-1,current_date,'Ana','all') as result",[s])
   let data=await report()
   assert.equal(data.count,1);assert.equal(data.revenue,180);assert.equal(data.cost,50)
   await r("select public.cancel_job($1,$2)",[s,id])
   data=await report()
   assert.equal(data.revenue,0);assert.equal(data.rows[0].cancelled,true)
 })
})
test("exclusão de conta libera e-mail e remove dados de sua própria empresa",async()=>{
 const id=randomUUID()
 await db.query("insert into auth.users values($1,'reuso@example.com',now())",[id])
 await as(master,r=>r("select public.set_account_access('reuso@example.com',true)"))
 const s=await as(master,r=>scalar(r,"select public.configure_company(null,'Temporária','starter','active',null,null,'reuso@example.com','Ana','services',null) as result"))
 await as(id,r=>r("select public.record_job($1,$2,'Consultoria','Ana',180,current_date-1,50,'pix')",[s,randomUUID()]))
 await as(master,r=>r("select public.delete_customer_account('reuso@example.com','reuso@example.com')"))
 assert.equal((await db.query("select * from public.stores where id=$1",[s])).rows.length,0)
 assert.equal((await db.query("select * from private.jobs where store_id=$1",[s])).rows.length,0)
 assert.equal((await db.query("select * from auth.users where email='reuso@example.com'")).rows.length,0)
 await db.query("insert into auth.users values($1,'reuso@example.com',now())",[randomUUID()])
 await assert.rejects(as(master,r=>r("select public.delete_customer_account('master@example.com','master@example.com')")),/gestor protegida/)
})

test("Adega consome e estorna gelo uma vez por venda e desconta o custo do lucro de hoje", async()=>{
  const adega=await as(master,run=>scalar(run,
    "select public.configure_company(null,'Adega do Chefinho','starter','active',null,null,'owner@example.com','Chefinho','retail',null) as result"))
  const subscription=JSON.stringify({endpoint:"https://fcm.googleapis.com/fcm/send/test"})
  await as(owner,run=>run("select public.register_sale_push($1,$2)",[adega,subscription]))
  await assert.rejects(as(outsider,run=>run("select public.register_sale_push($1,$2)",[adega,subscription])),/permissão/)
  const [ice,bucket,cup]=await as(owner,async run=>{
    const ids=[]
    for(const [name,stock,cost] of [["Gelo",10,2],["Baldão de Hisky",10,60],["Copão",10,50]]) {
      ids.push(await scalar(run,"select public.save_product($1,$2) as result",[adega,JSON.stringify(product(name,stock,cost))]))
    }
    return ids
  })
  const cart=JSON.stringify([{id:bucket,quantity:2},{id:cup,quantity:1}])
  const key=randomUUID()
  const record=(run,k)=>scalar(run,"select public.record_sale($1,$2,$3,10,'cash',null,null) as result",[adega,k,cart])
  const sale=await as(owner,run=>record(run,key))
  assert.equal((await as(owner,run=>record(run,key))).id,sale.id)
  const claim=()=>db.query("select public.claim_sale_push($1,$2) as subscription",[adega,sale.id])
  assert.equal((await claim()).rows.length,1)
  assert.equal((await claim()).rows.length,0)
  assert.equal((await as(owner,run=>state(run,ice,adega))).stock,3)
  await assert.rejects(as(owner,run=>record(run,randomUUID())),/Estoque de gelo insuficiente/)
  assert.equal((await as(owner,run=>state(run,bucket,adega))).stock,8)
  const report=await as(owner,run=>scalar(run,
    "select public.executive_report($1,current_date-1,current_date+1) as result",[adega]))
  assert.equal(report.metrics.last_24h_profit,120)
  assert.equal(report.metrics.month_profit,120)
  assert.equal(report.ranking.find(item=>item.product_id===bucket).cost,120)
  assert.equal(report.ranking.find(item=>item.product_id===cup).cost,50)
  assert.equal(report.ranking.reduce((total,item)=>total+item.profit,0),120)
  await db.query("update public.sales set created_at=now()-interval '25 hours' where id=$1",[sale.id])
  const updated=await as(owner,run=>scalar(run,
    "select public.executive_report($1,current_date-1,current_date+1) as result",[adega]))
  assert.equal(updated.metrics.last_24h_profit,0)
  assert.equal(updated.metrics.month_profit,120)
  await as(owner,run=>run("select public.cancel_sale($1,$2,'Teste',true)",[adega,sale.id]))
  assert.equal((await as(owner,run=>state(run,ice,adega))).stock,10)
})
