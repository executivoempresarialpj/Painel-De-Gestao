import Link from "next/link"
import {SaleAlerts} from "@/components/sale-alerts"
import {Receipt} from "@/components/receipt"
import {notFound,redirect} from "next/navigation"
import {Plus,LockKeyhole,ArrowRight,Upload} from "lucide-react"
import {session,can,type Store} from "@/lib/supabase"
import {Heading,ReportCharts} from "@/components/report-view"
import {Card} from "@/components/ui/card"
import {ActionForm} from "@/components/form"
import {MemberForm} from "@/components/store-forms"
import {EditProduct,MovementTable,Pagination,ProductTable,SearchForm,currentPage} from "@/components/tables"
import {ProductImport} from "@/components/product-import"
import {Pos} from "@/components/pos"
import {Period} from "@/components/period"
import {Trend} from "@/components/charts"
import {Exports} from "@/components/exports"
import type {Member,Movement,Product,Sale} from "@/lib/models"
import {dateRange,type Query,type Report} from "@/lib/report"
import {brl,movementLabels,num,paymentLabels,showDate} from "@/lib/utils"

const pages:Record<string,[string,string,string?]>={
  produtos:["Produtos","Gerencie seu catálogo, preços e disponibilidade."],
  estoque:["Estoque","Consulte saldos e registre movimentações da sua loja.","stock"],
  pdv:["Nova Venda — PDV","Registre vendas presenciais e acompanhe o carrinho."],
  vendas:["Histórico de Vendas","Consulte vendas, pagamentos e cancelamentos."],
  relatorios:["Relatórios","Analise vendas, faturamento, lucro bruto e estoque.","reports"],
  funcionarios:["Funcionários","Controle os vínculos e permissões da equipe.","staff"],
  configuracoes:["Configurações","Gerencie as preferências da loja e deste aparelho."],
  loja:["Cadastrar empresa","Crie um ambiente de trabalho para sua loja."]
}
const isId=(v?:string)=>!!v && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v)
const isoDate=(v?:string)=>v && /^\d{4}-\d{2}-\d{2}$/.test(v)?v:null
const stockKind=["entry","loss","damage","adjustment","withdrawal"]
type Client=NonNullable<Awaited<ReturnType<typeof session>>>["db"]

export default async function Section({params,searchParams}:{params:Promise<{section:string}>;searchParams:Promise<Query>}) {
  const [{section},query,auth]=await Promise.all([params,searchParams,session()])
  if(section==="loja") redirect(auth?.context.master?"/master":"/aguardando")
  if(!Object.hasOwn(pages,section)) notFound()
  const [title,subtitle,permission]=pages[section]
  const store=auth?.store
  if(store?.mode==="services" && ["pdv","vendas","relatorios"].includes(section))redirect("/servicos")
  if(!auth || (!store && section!=="loja") || (store && permission && !can(store,permission))) {
    const dest=!auth?"/login":!store?"/loja":"/pdv"
    return <><Heading title={title} subtitle={subtitle}/><Card className="gate"><span className="metric-icon blue"><LockKeyhole size={20}/></span><h2>{!auth?"Acesse sua conta":!store?"Selecione ou cadastre uma empresa":"Acesso restrito"}</h2><p>{!auth?"Entre para trabalhar com os dados da sua loja.":!store?"Verifique se a sua empresa está ativa ou cadastre uma nova.":"Seu perfil não tem acesso a esta seção."}</p><Link href={dest} className="button default">Continuar <ArrowRight size={16}/></Link></Card></>
  }

  if(!store) notFound()
  if(section==="configuracoes" && store.mode==="services" && !can(store,"settings")) redirect("/servicos")
  const db=auth.db
  const rpc=async <T,>(name:string,args:Record<string,unknown>)=>{
    const {data,error}=await db.rpc(name,args)
    if(error) throw new Error(error.message)
    return data as T
  }
  const page=currentPage(query)
  const catalog=(options:Record<string,unknown>={})=>rpc<Product[]>("product_catalog",{s:store.id,q:query.q ?? "",page_size:31,page_number:page,...options})
  const stocks=()=>rpc<Movement[]>("stock_history",{s:store.id,start_date:isoDate(query.from),end_date:isoDate(query.to),q:query.q ?? "",page_number:page})
  const heading=<Heading title={title} subtitle={subtitle}/>
  try {
    switch(section) {
      case "produtos": {
        const editable=can(store,"products")
        const [found,categories,selected]=await Promise.all([
          rpc<Product[]>("filtered_catalog",{s:store.id,q:query.q??"",selected_category:isId(query.category)?query.category:null,page_size:30,page_number:page,availability:query.availability||"all"}),db.from("categories").select("id,name").eq("store_id",store.id).order("name"),
          editable && isId(query.edit)?loadProduct(db,store,query.edit!):undefined
        ])
        return <><Heading title={title} subtitle={subtitle}>{editable && <><Link href="?import=1" className="button outline"><Upload size={16}/> Importar planilha</Link><Link href="?new=1" className="button default"><Plus size={17}/> Novo produto</Link></>}</Heading>
          {editable && query.import==="1" && <ProductImport key={store.id} store={store.id}/>}
          {editable && (query.new || selected) && <EditProduct key={selected?.id ?? "new"} store={store} product={selected}/>}
          <Card className="panel"><SearchForm query={query.q}><select name="availability" aria-label="Disponibilidade" defaultValue={query.availability}><option value="all">Todos os saldos</option><option value="low">Estoque baixo</option><option value="empty">Esgotados</option></select><select aria-label="Categoria" name="category" defaultValue={query.category ?? ""}><option value="">Todas as categorias</option>{categories.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></SearchForm>
            <Exports title="catalogo-pagina" headers={["SKU","Produto","Estoque","Preço de venda"]} rows={found.map(p=>[p.sku,p.name,p.stock,p.price])}/><ProductTable products={found} store={store} edit={editable}/><Pagination query={query} more={found.length===30}/></Card></>
      }
      case "pdv": {
        const products=await catalog({page_size:100,page_number:0,q:"",only_active:true})
        return <>{heading}<Pos zone={store.timezone} key={store.id} store={store.id} user={auth.user.id} initial={products.map(({cost:_,...p})=>p)}/></>
      }
      case "estoque": {
        const [found,movements,adjust]=await Promise.all([catalog({page_size:30,page_number:0}),stocks(),isId(query.adjust)?loadProduct(db,store,query.adjust!):undefined])
        return <>{heading}<Receipt store={store.id}/>{adjust && <Card className="panel"><div className="panel-heading"><h2>Movimentar · {adjust.name}</h2><Link className="text-link" href="/estoque">Fechar</Link></div><ActionForm operation="stock" store={store.id} label="Registrar movimentação">
          <input type="hidden" name="product" value={adjust.id}/><label>Operação<select name="kind">{stockKind.map(k=><option key={k} value={k}>{movementLabels[k]}</option>)}</select></label>
          <label>Quantidade<input name="amount" type="number" step=".001" required/><small>Para ajuste, use um valor negativo para reduzir o saldo.</small></label>
          <label>Motivo<input name="reason"/></label>
        </ActionForm></Card>}
        <Card className="panel"><h2>Saldo de produtos</h2><SearchForm query={query.q}><DateFields query={query}/></SearchForm><ProductTable products={found} store={store} adjust/>{found.length===30 && <p className="muted table-note">Use a busca para localizar outros produtos.</p>}</Card>
        <Card className="panel"><h2>Movimentações</h2><MovementTable rows={movements.slice(0,30)} zone={store.timezone}/><Pagination query={query} more={movements.length>30}/></Card></>
      }
      case "vendas": {
        const sales=await rpc<Sale[]>("sales_history",{s:store.id,start_date:isoDate(query.from),end_date:isoDate(query.to),product_query:query.q ?? "",operator_query:query.operator ?? "",payment_filter:query.payment ?? "",status_filter:query.status ?? "",page_number:page,sale_filter:isId(query.sale)?query.sale:null})
        return <>{heading}<Card className="panel"><SearchForm query={query.q} placeholder="Buscar produto vendido"><DateFields query={query}/><input name="operator" placeholder="Funcionário" aria-label="Funcionário" defaultValue={query.operator}/><select name="payment" aria-label="Forma de pagamento" defaultValue={query.payment ?? ""}><option value="">Todos os pagamentos</option>{Object.entries(paymentLabels).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select><select name="status" aria-label="Situação" defaultValue={query.status ?? ""}><option value="">Todas as situações</option><option value="completed">Concluída</option><option value="cancelled">Cancelada</option></select></SearchForm>
          {!sales.length && <p className="empty">Nenhuma venda encontrada.</p>}
          <div className="item-list">{sales.slice(0,30).map(sale=><details className="item-detail sale-history" key={sale.id} open={query.sale===sale.id}><summary><b>Venda #{sale.number}</b><span>{showDate(sale.created_at,store.timezone)}</span><span>{sale.operator}</span><span>{paymentLabels[sale.payment]}</span><span className={"badge "+(sale.status==="completed"?"green":"red")}>{sale.status==="completed"?"Concluída":"Cancelada"}</span><strong>{brl(sale.total)}</strong></summary>
            <div className="detail-body"><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Quantidade</th><th>Valor unitário</th></tr></thead><tbody>{sale.items?.map((item,index)=><tr key={index}><td>{item.name}</td><td>{num(item.quantity)}</td><td>{brl(item.price)}</td></tr>)}</tbody></table></div><p>Data da venda {sale.sale_day.split("-").reverse().join("/")} · Registro {showDate(sale.created_at,store.timezone)} · Cliente {sale.customer_name || "Não informado"}</p><p>Subtotal {brl(sale.subtotal)} · Desconto {brl(sale.discount)} · Total {brl(sale.total)}</p>
            {sale.cancellation && <p>Cancelada por {sale.cancellation.operator} em {showDate(sale.cancellation.created_at,store.timezone)} · {sale.cancellation.reason} · {sale.cancellation.restocked?"Estoque estornado":"Sem estorno de estoque"}</p>}
            {can(store,"cancel") && sale.status==="completed" && <details><summary>Cancelar venda</summary><ActionForm operation="cancel" store={store.id} danger label="Confirmar cancelamento"><input type="hidden" name="sale" value={sale.id}/><label>Motivo<input name="reason" required/></label><label className="check"><input type="checkbox" name="restore" defaultChecked/> Devolver itens ao estoque</label></ActionForm></details>}
          </div></details>)}</div><Pagination query={query} more={sales.length>30}/></Card></>
      }
      case "relatorios": {
        const range=dateRange(query,store.timezone)
        const view=query.view && ["sales","products","stock","movements"].includes(query.view)?query.view:"sales"
        const [report,products,movements]=await Promise.all([
          (view==="sales" || view==="products")?rpc<Report>("store_report",{s:store.id,from_day:range.from,to_day:range.to}):null,
          view==="stock"?catalog({page_size:30}):Promise.resolve([]),
          view==="movements"?rpc<Movement[]>("additions_report",{s:store.id,start_date:range.from,end_date:range.to,q:query.q ?? "",page_number:page}):Promise.resolve([])
        ])
        const m=report?.metrics
        const sortOptions={quantity:"Mais vendidos",gross:"Maior venda bruta",cost:"Maior custo",profit:"Maior lucro"}
        const sort=query.sort && Object.hasOwn(sortOptions,query.sort)?query.sort as keyof typeof sortOptions:"quantity"
        const productRows=(report?.ranking ?? []).filter(row=>row.name.toLocaleLowerCase("pt-BR").includes((query.q ?? "").trim().toLocaleLowerCase("pt-BR")) && (!query.product || row.product_id===query.product))
          .sort((a,b)=>b[sort]-a[sort] || a.name.localeCompare(b.name,"pt-BR"))
        const tabs={sales:"Vendas e faturamento",products:"Produtos vendidos",stock:"Estoque disponível",movements:"Adições de produtos"}
        const exportData=view==="products"?{headers:["Produto","Unidades","Venda bruta","Receita após descontos","Custo histórico","Lucro bruto"],rows:productRows.map(x=>[x.name,x.quantity,x.gross,Math.round((x.profit+x.cost)*100)/100,x.cost,x.profit])}:
          view==="stock"?{headers:["Produto","SKU","Quantidade","Custo unitário","Preço"],rows:products.map(p=>[p.name,p.sku,p.stock,p.cost ?? "",p.price])}:
          view==="movements"?{headers:["Data","Produto","Tipo","Quantidade","Saldo","Responsável","Motivo"],rows:movements.slice(0,30).map(x=>[showDate(x.created_at,store.timezone),x.product,movementLabels[x.kind],x.quantity,x.balance,x.operator,x.reason ?? "—"])}:
          report && m?{headers:["Data / indicador","Vendas / valor","Faturamento"],rows:[["Lucro bruto estimado",m.period_profit,""],["Ticket médio",m.ticket,""],...report.daily.map(d=>[d.date,d.sales,d.revenue]),...report.payments.map(p=>[paymentLabels[p.name],p.sales,p.revenue])]}:{headers:[],rows:[]}
        const qs=new URLSearchParams({period:range.selected,from:range.from,to:range.to})
        return <><Heading title={title} subtitle={subtitle}><Period key={range.selected+view} {...range} view={view} filters={view==="products"?{q:query.q ?? "",product:query.product ?? "",sort}:undefined}/><Exports title={"executivo-empresarial-"+view} {...exportData}/></Heading>
          <nav className="tabs" aria-label="Relatórios">{Object.entries(tabs).map(([key,label])=><Link className={view===key?"selected":""} key={key} href={"?"+qs.toString()+"&view="+key}>{label}</Link>)}</nav>
          {view==="stock"?<Card className="panel"><ProductTable products={products} store={store}/><Pagination query={query} more={products.length===30}/></Card>:
          view==="movements"?<Card className="panel"><MovementTable rows={movements.slice(0,30)} zone={store.timezone}/><Pagination query={query} more={movements.length>30}/></Card>:
          view==="products"?<Card className="panel"><h2>Desempenho por produto</h2><SearchForm query={query.q} placeholder="Buscar produto vendido"><label>Produto<select name="product" defaultValue={query.product ?? ""}><option value="">Todos</option>{report?.ranking.map(r=><option value={r.product_id} key={r.product_id}>{r.name}</option>)}</select></label><label>Ordenar por<select name="sort" defaultValue={sort}>{Object.entries(sortOptions).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><input type="hidden" name="view" value="products"/>{[...qs.entries()].map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}</SearchForm>{!!productRows.length && <p className="muted">Totais do filtro · {num(productRows.reduce((a,r)=>a+r.quantity,0))} unidades · Custo {brl(productRows.reduce((a,r)=>a+r.cost,0))} · Lucro {brl(productRows.reduce((a,r)=>a+r.profit,0))}</p>}{!productRows.length?<p className="empty">Nenhuma venda encontrada.</p>:<div className="table-wrap"><table><thead><tr><th>Produto</th><th>Unidades</th><th>Venda bruta</th><th>Receita após descontos</th><th>Custo das unidades</th><th>Lucro total do produto no período (após descontos)</th></tr></thead><tbody>{productRows.map(x=><tr key={x.product_id}><td>{x.name}</td><td>{num(x.quantity)}</td><td>{brl(x.gross)}</td><td>{brl(x.profit+x.cost)}</td><td>{brl(x.cost)}</td><td>{brl(x.profit)}</td></tr>)}</tbody></table></div>}</Card>:
          report && m && <><div className="summary-grid">{[["Vendas",num(m.period_sales)],["Faturamento",brl(m.period_revenue)],["Ticket médio",brl(m.ticket)],["Lucro bruto estimado",brl(m.period_profit)],["Unidades vendidas",num(m.units_sold)]].map(([label,v])=><Card className="metric" key={label}><h3>{label}</h3><strong>{v}</strong></Card>)}</div>
            <Card className="panel chart-card"><h2>Faturamento por dia</h2><p className="muted">Faturamento é o total das vendas concluídas após descontos. O lucro bruto estimado deduz o custo histórico dos itens vendidos.</p><Trend data={report.daily}/></Card><ReportCharts report={report}/></>}
        </>
      }
      case "funcionarios": {
        const members=await rpc<Member[]>("member_list",{s:store.id})
        return <>{heading}<Card className="panel"><h2>Vincular funcionário</h2><p className="muted">O gestor cria o e-mail de acesso e define a senha do funcionário. Aqui, vincule o e-mail à loja e escolha o perfil.</p><MemberForm store={store.id}/></Card>
          <Card className="panel"><h2>Equipe da loja</h2><div className="item-list">{members.map(member=><details className="item-detail" key={member.user_id}><summary><b>{member.name}</b><span>{member.email}</span><span>{member.role==="owner"?"Proprietário":member.role==="manager"?"Gerente":"Operador de caixa"}</span><span className={"badge "+(member.active?"green":"neutral")}>{member.active?"Ativo":"Inativo"}</span></summary><div className="detail-body">{member.role==="owner"?<p>Proprietário da empresa.</p>:<MemberForm store={store.id} member={member}/>}</div></details>)}</div></Card></>
      }
      case "configuracoes":
        return <>{heading}{store.mode!=="services" && <SaleAlerts key={store.id} store={store.id}/>}
          {can(store,"settings") && <Card className="panel"><ActionForm store={store.id} operation="settings"><label>Nome da loja<input name="name" minLength={2} maxLength={120} required defaultValue={store.name}/></label><label>Estoque mínimo para novos cadastros<input name="minimum" type="number" min="0" step=".001" required defaultValue={store.minimum??0}/></label><label>Unidade para novos cadastros<input name="unit" required maxLength={16} defaultValue={store.unit??"un"}/></label><label>Fuso horário (IANA)<input name="timezone" defaultValue={store.timezone} required/></label></ActionForm></Card>}</>
    }
  } catch(error) {
    return <>{heading}<Card className="panel"><p role="alert" className="error">{error instanceof Error?error.message:"Não foi possível carregar os dados. Tente novamente."}</p></Card></>
  }
}
function DateFields({query}:{query:Query}) {
  return <><label>De<input type="date" name="from" defaultValue={query.from}/></label><label>Até<input type="date" name="to" defaultValue={query.to}/></label></>
}
async function loadProduct(db:Client,store:Store,id:string) {
  const {data,error}=await db.rpc("product_by_id",{s:store.id,p:id})
  if(error) throw new Error(error.message)
  return (data as Product|null) ?? undefined
}
