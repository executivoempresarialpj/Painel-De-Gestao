import {dayIn} from "@/lib/utils"
export type Series={date:string;sales:number;revenue:number}
export type Ranking={product_id:string;name:string;quantity:number;gross:number;profit:number;cost:number}
export type Report={
  metrics:{today_sales:number;month_sales:number;today_revenue:number;today_profit?:number;month_revenue:number;all_revenue:number;ticket:number;period_sales:number;period_revenue:number;month_profit:number;period_profit:number;units_sold:number}
  inventory:{products:number;items:number;value:number;low:number;empty:number}
  daily:Series[];monthly:Series[];ranking:Ranking[];categories:{name:string;quantity:number}[];payments:{name:string;sales:number;revenue:number}[]
}
export const periods={today:"Hoje",yesterday:"Ontem",week:"Últimos 7 dias",days30:"Últimos 30 dias",month:"Mês atual",previous:"Mês anterior",year:"Ano atual",custom:"Período personalizado"}
export type Query=Record<string,string|undefined>
function iso(date:Date){return date.toISOString().slice(0,10)}
export function dateRange(query:Query,zone:string){
  const today=dayIn(zone)
  const selected=query.period && Object.hasOwn(periods,query.period)?query.period as keyof typeof periods:"week"
  const [y,m]=today.split("-").map(Number)
  const days=(n:number)=>iso(new Date(new Date(today).valueOf()-n*86400000))
  const valid=(v?:string)=>!!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && iso(new Date(v))===v
  let from=days(6),to=today
  switch(selected) {
    case "today": from=today; break
    case "yesterday": from=to=days(1); break
    case "days30": from=days(29); break
    case "month": from=today.slice(0,7)+"-01"; break
    case "previous": from=iso(new Date(Date.UTC(y,m-2,1)));to=iso(new Date(Date.UTC(y,m-1,0))); break
    case "year": from=y+"-01-01"; break
    case "custom": if(valid(query.from)&&valid(query.to)) {from=query.from!;to=query.to!}; break
  }
  return {from,to,selected}
}
