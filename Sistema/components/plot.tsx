"use client"
import {Area,AreaChart,Bar,BarChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts"
import {Package,ChartNoAxesCombined} from "lucide-react"
import type {Series} from "@/lib/report"
import {brl,num} from "@/lib/utils"

export default function Plot({data,metric="revenue",monthly=false,bars=false}:{data:Series[];metric?:"revenue"|"sales";monthly?:boolean;bars?:boolean}) {
  const values=data.map(row=>({...row,label:monthly?new Intl.DateTimeFormat("pt-BR",{month:"short",timeZone:"UTC"}).format(new Date(row.date)).replace(".",""):row.date.slice(8)+"/"+row.date.slice(5,7)}))
  const cash=metric==="revenue"
  const empty=!values.some(row=>row[metric]>0)
  const axis=(n:number)=>cash?(n>=1000?"R$ "+num(n/1000)+" mil":"R$ "+num(n)):num(n)
  return <div className="trend">
    <ResponsiveContainer width="100%" height="100%" initialDimension={{width:620,height:238}}>
      {bars?<BarChart data={values} margin={{top:12,right:12,bottom:3,left:5}}><CartesianGrid vertical={false} stroke="#e9edf3" strokeDasharray="4 4"/><XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={13} fontSize={11} minTickGap={12}/><YAxis width={62} axisLine={false} tickLine={false} fontSize={11} tickFormatter={axis} allowDecimals={cash} domain={empty?[0,4]:[0,"auto"]}/><Tooltip formatter={v=>[cash?brl(Number(v)):num(Number(v)),cash?"Faturamento":"Vendas"]}/><Bar isAnimationActive={false} dataKey={metric} fill="#647d86" radius={[5,5,0,0]}/></BarChart>:
      <AreaChart data={values} margin={{top:12,right:12,bottom:3,left:5}}><defs><linearGradient id={metric+"-wash"} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#647d86" stopOpacity={.26}/><stop offset="100%" stopColor="#647d86" stopOpacity={.02}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#e9edf3" strokeDasharray="4 4"/><XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={13} fontSize={11} minTickGap={20}/><YAxis width={62} axisLine={false} tickLine={false} fontSize={11} tickFormatter={axis} allowDecimals={cash} domain={empty?[0,4]:[0,"auto"]}/><Tooltip formatter={v=>[cash?brl(Number(v)):num(Number(v)),cash?"Faturamento":"Vendas"]}/><Area isAnimationActive={false} type="monotone" dataKey={metric} fill={"url(#"+metric+"-wash)"} stroke={empty?"#a9bde9":"#355769"} strokeWidth={2.5} dot={values.length===1}/></AreaChart>}
    </ResponsiveContainer>
    {empty && <div className="chart-empty"><ChartNoAxesCombined size={18}/> Nenhuma venda no período</div>}
  </div>
}
