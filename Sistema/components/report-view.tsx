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
  const groups=[
    {title:"Resumo recente",className:"daily-metrics",metrics:[
    {label:"Vendas hoje",value:count(m?.today_sales),detail:"Vendas concluídas hoje",icon:ShoppingCart,color:"blue"},
    {label:"Faturamento hoje",value:currency(m?.today_revenue),detail:"Receita de vendas hoje",icon:CircleDollarSign,color:"green"},
    {label:"Lucro das últimas 24 horas",value:currency(m?.last_24h_profit),detail:"Vendas registradas nas últimas 24h, menos os custos",icon:TrendingUp,color:"green"}
    ]},
    {title:"Vendas e faturamento",className:"summary-metrics",metrics:[
    {label:"Vendas no mês",value:count(m?.month_sales),detail:"Vendas concluídas no mês",icon:Receipt,color:"violet"},
    {label:"Faturamento no mês",value:currency(m?.month_revenue),detail:"Receita no mês atual",icon:Wallet,color:"blue"},
    {label:"Lucro bruto no mês",value:currency(m?.month_profit),detail:"Receita após descontos menos os custos do mês",icon:TrendingUp,color:"green"},
    {label:"Faturamento acumulado",value:currency(m?.all_revenue),detail:"Desde o início da operação",icon:Banknote,color:"violet"},
    {label:"Ticket médio",value:currency(m?.ticket),detail:"Por venda no período",icon:BadgeDollarSign,color:"cyan"},
    ]},
    {title:"Estoque",className:"summary-metrics",metrics:[
    {label:"Produtos cadastrados",value:count(inventory?.products),detail:"No seu catálogo",icon:Package,color:"blue"},
    {label:"Itens em estoque",value:count(inventory?.items),detail:"Quantidade disponível",icon:Boxes,color:"cyan"},
    {label:"Valor do estoque",value:currency(inventory?.value),detail:"A preço de custo",icon:Wallet,color:"violet"},
    {label:"Estoque baixo",value:count(inventory?.low),detail:"No limite ou abaixo do mínimo",icon:TriangleAlert,color:"amber"},
    {label:"Produtos esgotados",value:count(inventory?.empty),detail:"Ativos sem unidades disponíveis",icon:PackageX,color:"red"}
    ]}
  ]
  return <>
    <Heading title="Painel Executivo" subtitle="Acompanhe o desempenho e a operação da sua loja em um só lugar.">
      <Period key={range.selected} {...range}/><Link className="button default" href="/pdv"><ShoppingCart size={17}/> Nova venda</Link>
    </Heading>
    <section className="overview-banner dashboard-banner">
      <div className="banner-content"><span className="banner-icon"><ChartNoAxesCombined size={21}/></span><div><h2>{user?<>Olá, {user}!</>:"Visão geral da sua loja"}</h2><p>{report?"Confira os principais indicadores de vendas e estoque.":"Conecte sua loja para acompanhar vendas e estoque em tempo real."}</p></div></div>

    </section>
    {!configured && <span className="connection"><span/> Banco não configurado</span>}
    {groups.map(group=><section key={group.title} className="dashboard-section">
      <h2>{group.title}</h2>
      <div className={"metric-grid dashboard-metrics "+group.className}>
        {group.metrics.map(({label,value,detail,icon:Icon,color})=>
          <Card className={"metric"+(label==="Lucro das últimas 24 horas"?" daily-profit":"")} key={label}>
            <div className="metric-label"><span className={"metric-icon "+color}><Icon size={17}/></span><h3>{label}</h3></div>
            <EmptyValue value={value}/><p>{detail}</p>
          </Card>)}
      </div>
    </section>)}
    <div className="highlight-grid">
      <Card className="chart-card"><div className="chart-heading"><span className="metric-icon blue"><BarChart3 size={19}/></span><div><h3>Faturamento por dia</h3><p>Receita de vendas no período selecionado</p></div></div><Trend data={report?.daily ?? []}/></Card>
      <Card className="chart-card"><div className="chart-heading"><span className="metric-icon amber"><Trophy size={18}/></span><div><h3>Produtos mais vendidos</h3><p>Ranking por quantidade vendida</p></div></div><RankingList rows={(report?.ranking ?? []).slice(0,5).map(x=>({name:x.name,amount:x.quantity}))}/>{showReports && <Link className="ranking-link" href="/relatorios">Ver relatórios <ArrowRight size={15}/></Link>}</Card>
    </div>
    {report && <Card className="panel"><div className="panel-heading"><div><h2>Lucro total por produto</h2><p className="muted">Receita após descontos menos os custos dos produtos e dos insumos no período.</p></div>{showReports && <Link href={"/relatorios?view=products&period=custom&from="+range.from+"&to="+range.to}>Ver todos</Link>}</div>{report.ranking.length?<div className="table-wrap"><table><thead><tr><th>Produto</th><th>Unidades vendidas</th><th>Lucro bruto total</th></tr></thead><tbody>{[...report.ranking].sort((a,b)=>b.profit-a.profit).slice(0,5).map(r=><tr key={r.product_id}><td>{r.name}</td><td>{num(r.quantity)}</td><td><strong>{brl(r.profit)}</strong></td></tr>)}</tbody></table></div>:<p>Nenhuma venda no período.</p>}</Card>}
    {report && <ReportCharts report={report}/>}
  </>
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
