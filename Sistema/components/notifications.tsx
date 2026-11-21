"use client"
import {useEffect,useRef,useState} from "react"
import Link from "next/link"
import {usePathname} from "next/navigation"
import {Bell} from "lucide-react"
import {readAlerts} from "@/app/actions"

export function Notifications({store}:{store:string}){
 const path=usePathname()
 const [unread,setUnread]=useState(false)
 const [open,setOpen]=useState(false)
 const [items,setItems]=useState<{id:string;name:string;sku:string;stock:number}[]>([])
 const [error,setError]=useState("")
 const [busy,setBusy]=useState(false)
 const version=useRef(0)
 useEffect(()=>{
   let active=true
   let fetching=false
   async function refresh(){
     if(document.hidden || fetching)return
     const generation=version.current
     fetching=true
     try{
       const res=await fetch("/api/alertas?s="+encodeURIComponent(store),{cache:"no-store"})
       if(res.ok){const data=await res.json();if(active && generation===version.current)setUnread(data.unread)}
     }catch{}finally{fetching=false}
   }
   void refresh()
   const timer=setInterval(refresh,45000)
   document.addEventListener("visibilitychange",refresh)
   window.addEventListener("stock-changed",refresh)
   return ()=>{active=false;clearInterval(timer);document.removeEventListener("visibilitychange",refresh);window.removeEventListener("stock-changed",refresh)}
 },[store,path])
 async function review(){
   if(open){setOpen(false);return}
   version.current++
   setBusy(true);setError("");setItems([]);setOpen(true)
   try{const list=await readAlerts(store);setItems(list);setUnread(false);window.dispatchEvent(new Event("stock-changed"))}
   catch{setError("Falha ao verificar os avisos. Feche e tente novamente.")}
   finally{setBusy(false)}
 }
 return <div className="stock-notifications"><button aria-expanded={open} disabled={busy} className="icon-button" onClick={review} aria-label={unread?"Ver novos avisos de estoque":"Ver avisos de estoque"}><Bell size={19}/>{unread && <i className="pulse-dot"/>}</button>
 {open && <section className="alerts-panel"><h3>Avisos de estoque</h3>{busy?"Consultando…":error || (!items.length?"Nenhum aviso novo.":<ul>{items.map(p=><li key={p.id}>{p.name} <small>{p.stock===0?"Esgotado":"Estoque baixo · "+p.stock} · {p.sku}</small></li>)}</ul>)}<Link href="/produtos?availability=empty" onClick={()=>setOpen(false)}>Esgotados</Link> · <Link href="/produtos?availability=low" onClick={()=>setOpen(false)}>Estoque baixo</Link></section>}</div>
}
