"use client"
import {useState} from "react"
import Link from "next/link"
type Item={id:string;name:string;stock:number}
export function StockWelcome({empty,low}:{empty:Item[];low:Item[]}){
 const [visible,setVisible]=useState(true)
 if(!visible || !(empty.length || low.length))return null
 return <aside className="card panel" aria-label="Avisos de estoque"><div className="chart-heading"><h2>Atenção ao estoque</h2><button className="button outline" onClick={()=>setVisible(false)}>Entendi</button></div>{[[empty,"Esgotados","empty"],[low,"Acabando","low"]].map(group=>{
 const [items,title,filter]=group as [Item[],string,string]
 return items.length>0 && <p key={filter}><b>{title}</b> · {items.slice(0,5).map(i=>i.name+" ("+i.stock+")").join(", ")} · <Link href={"/produtos?availability="+filter}>Ver lista</Link></p>
 })}</aside>
}
