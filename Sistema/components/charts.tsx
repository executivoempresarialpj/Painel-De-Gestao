"use client"
import dynamic from "next/dynamic"
import {useState} from "react"
import {Package} from "lucide-react"
import type {Series} from "@/lib/report"
import {brl,num} from "@/lib/utils"
const Plot=dynamic(()=>import("./plot"),{ssr:false,loading:()=><div className="trend" aria-busy="true">Carregando gráfico…</div>})
export function Trend({data,monthly=false,metric="revenue"}:{data:Series[];monthly?:boolean;metric?:"revenue"|"sales"}){
 const [bars,setBars]=useState(monthly)
 if(!data.some(row=>row[metric]>0))return <p className="empty">Nenhuma venda no período.</p>
 return <><label className="chart-mode">Visualização<select value={bars?"bars":"line"} onChange={e=>setBars(e.target.value==="bars")}><option value="line">Linha</option><option value="bars">Colunas</option></select></label><Plot data={data} monthly={monthly} metric={metric} bars={bars}/></>
}
export function RankingList({rows,currency=false}:{rows:{name:string;amount:number}[];currency?:boolean}) {
  if(!rows.length) return <div className="ranking-empty"><span><Package size={23}/></span><b>Nenhum dado no período</b><p>Os resultados aparecem após registrar vendas.</p></div>
  const max=Math.max(...rows.map(r=>r.amount))
  return <ol className="ranking-list">{rows.map((row,index)=><li key={index}><div><span>{row.name}</span><b>{currency?brl(row.amount):num(row.amount)}</b></div><progress max={max || 1} value={row.amount} aria-label={row.name}/></li>)}</ol>
}
