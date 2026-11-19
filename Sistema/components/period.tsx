"use client"
import {useState} from "react"
import {CalendarDays,ChevronDown} from "lucide-react"
import {usePathname,useRouter} from "next/navigation"
import {periods} from "@/lib/report"
export function Period({selected,from,to,view,filters={}}:{selected:keyof typeof periods;from:string;to:string;view?:string;filters?:Record<string,string>}) {
  const pathname=usePathname()
  const router=useRouter()
  const [custom,setCustom]=useState(selected==="custom")
  return <form className="period" action={pathname}>{view && <input type="hidden" name="view" value={view}/>}
    {Object.entries(filters).map(([k,v])=><input key={k} name={k} value={v} type="hidden"/>)}
    <div className="period-select"><CalendarDays size={16}/><select aria-label="Período" name="period" defaultValue={selected} onChange={e=>{
      setCustom(e.target.value==="custom")
      if(e.target.value!=="custom") router.push(pathname+"?"+new URLSearchParams({...filters,...(view?{view}:{}),period:e.target.value}))
    }}>{Object.entries(periods).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><ChevronDown size={15}/></div>
    {custom && <div className="custom-period"><label>De<input type="date" name="from" defaultValue={from} required/></label><label>Até<input type="date" name="to" defaultValue={to} required/></label><button className="button outline">Aplicar</button></div>}
  </form>
}
