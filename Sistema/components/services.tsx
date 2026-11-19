import Link from "next/link"
import {Heading} from "@/components/report-view"
import {Period} from "@/components/period"
import {Trend} from "@/components/charts"
import {brl,num} from "@/lib/utils"
import {dateRange,type Query,type Series} from "@/lib/report"
import {session,type Store} from "@/lib/supabase"

export type ServiceRow={id:string;day:string;title:string;customer:string|null;amount:number;cost:number|null;method:string|null;cancelled:boolean}
type Overview={count:number;revenue:number;cost:number|null;inventory:number|null;daily:Series[];top:{title:string;count:number;revenue:number}[];rows:ServiceRow[]}

export async function serviceOverview(store:Store,query:Query){
  const auth=await session()
  const range=dateRange({period:"month",...query},store.timezone)
  const {data,error}=await auth!.db.rpc("service_overview",{s:store.id,a:range.from,b:range.to,search:(query.q ?? "").trim().slice(0,120),state:query.state==="active" || query.state==="cancelled"?query.state:"all"})
  return {range,data:data as Overview|null,error}
}

export async function ServiceDashboard({store,query}:{store:Store;query:Query}){
  const {range,data,error}=await serviceOverview(store,query)
  return <>
    <Heading title="Painel Executivo" subtitle={store.name}><Period {...range}/><Link href="/servicos#registrar" className="button default">Novo serviço</Link></Heading>
    {error && <p role="alert" className="error">{error.message}</p>}
    {data && <>
      <div className="metric-grid dashboard-metrics">
        {[["Serviços concluídos",num(data.count)],["Receita de serviços",brl(data.revenue)],["Ticket médio",brl(data.count?data.revenue/data.count:0)],["Custos diretos",brl(data.cost ?? 0)],["Resultado bruto",brl(data.revenue-(data.cost ?? 0))],["Estoque a custo",brl(data.inventory ?? 0)]].map(([label,v])=><div className="card metric" key={label}><h3>{label}</h3><strong>{v}</strong></div>)}
      </div>
      <div className="highlight-grid">
        <section className="card chart-card"><h2>Receita por dia</h2><Trend data={data.daily}/></section>
        <section className="card chart-card"><h2>Serviços com maior receita</h2>
          {data.top.length?<ul className="ranking-list">{data.top.map(r=><li key={r.title}><div><span>{r.title} · {num(r.count)}</span><b>{brl(r.revenue)}</b></div></li>)}</ul>:<p>Nenhum serviço no período.</p>}
          <Link href="/servicos">Ver histórico de serviços</Link>
        </section>
      </div>
    </>}
  </>
}
