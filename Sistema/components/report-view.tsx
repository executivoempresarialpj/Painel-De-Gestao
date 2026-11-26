import Link from "next/link"
import {ArrowUpRight, ShoppingCart, CircleDollarSign, Wallet, Banknote, Receipt, TrendingUp, Package, Boxes, BadgeDollarSign, TriangleAlert, PackageX, ChartNoAxesCombined, BarChart3, Trophy, ArrowRight} from "lucide-react"
import {Card} from "@/components/ui/card"
import {Period} from "@/components/period"
import {RankingList,Trend} from "@/components/charts"
import {brl,num,paymentLabels} from "@/lib/utils"
import {dateRange,type Report} from "@/lib/report"

export function Heading({title,subtitle,children}:{title:string;subtitle:string;children?:React.ReactNode}) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="heading-actions">{children}</div></div>
}
function EmptyValue({value}:{value?:string}) {return <strong>{value ?? "—"}</strong>}
export function Dashboard({report,range,user,signedIn,configured,showReports}:{showReports:boolean;report?:Report;range:ReturnType<typeof dateRange>;user?:string;signedIn:boolean;configured:boolean}) {
  const m=report?.metrics
  const inventory=report?.inventory
  const currency=(n?:number)=>n===undefined?undefined:brl(n)
  const count=(n?:number)=>n===undefined?undefined:num(n)
  const financial=[
    {label:"Faturamento no mês",value:currency(m?.month_revenue),icon:Wallet},
    {label:"Lucro bruto no mês",value:currency(m?.month_profit),icon:TrendingUp},
    {label:"Vendas no mês",value:count(m?.month_sales),icon:Receipt},
    {label:"Ticket médio",value:currency(m?.ticket),icon:BadgeDollarSign},
    {label:"Faturamento acumulado",value:currency(m?.all_revenue),icon:Banknote}
  ]
  const stocks=[
    {label:"Produtos cadastrados",value:count(inventory?.products),icon:Package},
    {label:"Itens em estoque",value:count(inventory?.items),icon:Boxes},
    {label:"Valor do estoque",value:currency(inventory?.value),icon:Wallet},
    {label:"Estoque baixo",value:count(inventory?.low),icon:TriangleAlert},
    {label:"Produtos esgotados",value:count(inventory?.empty),icon:PackageX}
  ]
  return <div className="executive-dashboard">
    <Heading title="Visão geral" subtitle={user?"Olá, "+user+". Acompanhe sua operação.":"Acompanhe os resultados da sua operação."}>
      <Period key={range.selected} {...range}/><Link className="button default" href="/pdv"><ShoppingCart size={17}/> Nova venda</Link>
    </Heading>
    {!configured && <span className="connection"><span/> Banco não configurado</span>}
    <section className="exec-hero">
      <div className="exec-hero-main"><div className="exec-kicker"><TrendingUp size={16}/> Desempenho financeiro</div><p>Lucro das últimas 24 horas</p><EmptyValue value={currency(m?.last_24h_profit)}/><small>Receitas de vendas menos custos dos itens e insumos.</small></div>
      <div className="exec-hero-side"><div><span>Faturamento hoje</span><EmptyValue value={currency(m?.today_revenue)}/></div><div><span>Vendas hoje</span><EmptyValue value={count(m?.today_sales)}/></div></div>
    </section>
    <section className="exec-section">
      <div className="exec-section-heading"><h2>Resultados financeiros</h2><span>Visão consolidada</span></div>
      <div className="exec-stat-grid">{financial.map(({label,value,icon:Icon})=><Card className="exec-stat" key={label}><Icon size={17}/><span>{label}</span><EmptyValue value={value}/></Card>)}</div>
    </section>
    <div className="exec-charts">
      <Card className="chart-card exec-chart"><div className="chart-heading"><span className="metric-icon blue"><BarChart3 size={19}/></span><div><h2>Faturamento por dia</h2><p>Período selecionado</p></div></div><Trend data={report?.daily ?? []}/></Card>
      <Card className="chart-card exec-chart"><div className="chart-heading"><span className="metric-icon blue"><Trophy size={19}/></span><div><h2>Mais vendidos</h2><p>Ranking por quantidade</p></div></div><RankingList rows={(report?.ranking ?? []).slice(0,5).map(x=>({name:x.name,amount:x.quantity}))}/>{showReports && <Link className="ranking-link" href="/relatorios">Ver relatórios <ArrowRight size={15}/></Link>}</Card>
    </div>
    <section className="exec-section"><div className="exec-section-heading"><h2>Estoque e disponibilidade</h2><span>Saldo atual</span></div><div className="exec-stat-grid">{stocks.map(({label,value,icon:Icon})=><Card className="exec-stat" key={label}><Icon size={17}/><span>{label}</span><EmptyValue value={value}/></Card>)}</div></section>
    {report && <Card className="panel exec-profit-list"><div className="panel-heading"><div><h2>Lucro total por produto</h2><p className="muted">Receitas após descontos menos custos no período.</p></div>{showReports&&<Link className="text-link" href={"/relatorios?view=products&period=custom&from="+range.from+"&to="+range.to}>Ver todos</Link>}</div>{report.ranking.length?<div className="exec-profit-rows">{[...report.ranking].sort((a,b)=>b.profit-a.profit).slice(0,5).map((r,i)=><div className="exec-profit-row" key={r.product_id}><span className="exec-rank">{String(i+1).padStart(2,"0")}</span><div><span>{r.name}</span><small>{num(r.quantity)} unidades vendidas</small></div><strong>{brl(r.profit)}</strong></div>)}</div>:<p className="empty">Nenhuma venda no período.</p>}</Card>}
    {report && <details className="exec-more"><summary>Mais análises e gráficos <ArrowRight size={16}/></summary><ReportCharts report={report}/></details>}
  </div>
}
export function ReportCharts({report}:{report:Report}) {
  return <div className="report-charts">
    <Card className="chart-card"><h3>Vendas por dia</h3><Trend data={report.daily} metric="sales"/></Card>
    <Card className="chart-card"><h3>Faturamento por mês</h3><p className="muted">12 meses até o fim do período</p><Trend data={report.monthly} monthly/></Card>
    <Card className="chart-card"><h3>Comparativo mensal de vendas</h3><p className="muted">12 meses até o fim do período</p><Trend data={report.monthly} metric="sales" monthly/></Card>
    <Card className="chart-card"><h3>Unidades vendidas por produto</h3><RankingList rows={report.ranking.map(x=>({name:x.name,amount:x.quantity}))}/></Card>
    <Card className="chart-card"><h3>Unidades vendidas por categoria</h3><RankingList rows={report.categories.map(x=>({name:x.name,amount:x.quantity}))}/></Card>
    <Card className="chart-card"><h3>Faturamento por pagamento</h3><PaymentRanking report={report}/></Card>
  </div>
}
function PaymentRanking({report}:{report:Report}) {
  return <RankingList currency rows={report.payments.map(x=>({name:paymentLabels[x.name] ?? x.name,amount:x.revenue}))}/>
}
