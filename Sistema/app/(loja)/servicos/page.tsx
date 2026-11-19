import {redirect} from "next/navigation"
import {can,session} from "@/lib/supabase"
import {brl,dayIn,paymentLabels} from "@/lib/utils"
import {ActionForm} from "@/components/form"
import {Heading} from "@/components/report-view"
import {Exports} from "@/components/exports"
import {serviceOverview} from "@/components/services"
import type {Query} from "@/lib/report"

const methods={...paymentLabels,other:"Outro"}
export default async function Services({searchParams}:{searchParams:Promise<Query>}){
 const auth=await session(),store=auth?.store
 if(!auth || !store || store.mode!=="services")redirect("/")
 const today=dayIn(store.timezone),q=await searchParams
 const {range,data,error}=await serviceOverview(store,{...q,period:q.from && q.to?"custom":"month"})
 const financial=can(store,"executive") || can(store,"reports")
 const headers=["Data","Serviço","Cliente","Valor","Pagamento","Situação",...(financial?["Custo direto"]:[])]
 const rows=(data?.rows ?? []).map(r=>[r.day.split("-").reverse().join("/"),r.title,r.customer || "—",brl(r.amount),methods[r.method as keyof typeof methods] || "—",r.cancelled?"Cancelado":"Concluído",...(financial?[brl(r.cost ?? 0)]:[])])
 return <>
   <Heading title="Serviços" subtitle="Registre atendimentos e acompanhe o histórico."><a href="#registrar" className="button default">Novo serviço</a></Heading>
   <section id="registrar" className="card panel"><h2>Registrar serviço</h2><ActionForm operation="job" store={store.id} label="Registrar">
     <input type="hidden" name="key" value={crypto.randomUUID()}/>
     <label>Nome do serviço<input name="description" maxLength={120} required/></label>
     <label>Cliente (opcional)<input name="buyer" maxLength={120}/></label>
     <label>Valor cobrado (R$)<input name="amount" type="number" min=".01" step=".01" required/></label>
     <label>Custo direto (R$, opcional)<input name="cost" type="number" min="0" step=".01"/></label>
     <label>Pagamento<select name="method">{Object.entries(methods).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
     <label>Data<input name="day" type="date" max={today} defaultValue={today} required/></label>
   </ActionForm></section>
   <section className="card panel"><div className="panel-heading"><h2>Histórico de serviços</h2>{!!rows.length && <Exports title="servicos" headers={headers} rows={rows}/>}</div>
     <form className="filters"><label>De<input name="from" type="date" defaultValue={range.from} required/></label><label>Até<input name="to" type="date" defaultValue={range.to} required/></label><label>Buscar<input name="q" placeholder="Serviço ou cliente" defaultValue={q.q}/></label><label>Situação<select name="state" defaultValue={q.state || "all"}><option value="all">Todas</option><option value="active">Concluídos</option><option value="cancelled">Cancelados</option></select></label><button className="button outline">Filtrar</button></form>
     {error?<p role="alert" className="error">{error.message}</p>:rows.length?<div className="table-wrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}{can(store,"cancel") && <th>Ações</th>}</tr></thead><tbody>{data!.rows.map((r,i)=><tr key={r.id}>{rows[i].map((cell,j)=><td key={j}>{cell}</td>)}{can(store,"cancel") && <td>{!r.cancelled && <details><summary>Cancelar</summary><ActionForm operation="cancelJob" store={store.id} label="Confirmar" danger><input type="hidden" name="id" value={r.id}/></ActionForm></details>}</td>}</tr>)}</tbody></table></div>:<p>Nenhum serviço encontrado.</p>}
   </section>
 </>
}
