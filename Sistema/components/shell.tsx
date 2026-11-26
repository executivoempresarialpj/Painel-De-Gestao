"use client"
import {Notifications} from "@/components/notifications"
import Link from "next/link"
import {usePathname} from "next/navigation"
import {useState} from "react"
import { Receipt as ReceiptIcon, LayoutDashboard, Package, Boxes, ArrowDownToLine, ShoppingCart, History, ChartNoAxesCombined, UsersRound, Settings, Store as StoreIcon, ChevronsUpDown, ChevronDown, PanelLeft, Menu, X, LogOut, LogIn, ShieldCheck } from "lucide-react"
import {chooseStore,logout} from "@/app/actions"
import type {Store} from "@/lib/supabase"

const retailLinks = [
  {title:"Painel Executivo",href:"/",icon:LayoutDashboard},
  {title:"Produtos",href:"/produtos",icon:Package},
  {title:"Estoque",href:"/estoque",icon:Boxes},
  {title:"Adicionar estoque",href:"/entrada-estoque",icon:ArrowDownToLine},
  {title:"Nova Venda — PDV",href:"/pdv",icon:ShoppingCart},
  {title:"Histórico de Vendas",href:"/vendas",icon:History},
  {title:"Relatórios",href:"/relatorios",icon:ChartNoAxesCombined},
  {title:"Funcionários",href:"/funcionarios",icon:UsersRound},
  {title:"Configurações",href:"/configuracoes",icon:Settings}
]
const administration=["/funcionarios"]
const roles={owner:"Proprietário",manager:"Gerente",cashier:"Operador de caixa"}
export function Shell({children,store,stores,email,master}:{children:React.ReactNode;store?:Store;stores:Store[];email?:string;master:boolean}) {
  const links=store?.mode==="services"?retailLinks.filter(l=>!["/vendas","/pdv","/relatorios"].includes(l.href)).concat([{title:"Serviços",href:"/servicos",icon:ReceiptIcon}]):retailLinks
  const pathname=usePathname()
  const [open,setOpen]=useState(false)
  const [collapsed,setCollapsed]=useState(false)
  const [menu,setMenu]=useState(false)
  const current=links.find(link=>link.href===pathname)
  const allowed=(key:string)=>store?.role==="owner" || !!store?.permissions.includes(key)
  const visible=links.filter(link=> !store || !(
    link.href==="/" && !allowed("executive") || link.href==="/relatorios" && !allowed("reports") ||
    ["/estoque","/entrada-estoque"].includes(link.href) && !allowed("stock") ||
    administration.includes(link.href) && store.role!=="owner" ||
    link.href==="/configuracoes" && store.mode==="services" && !allowed("settings")
  ))
  return <div className={collapsed?"shell collapsed":"shell"}>
    {open && <button className="scrim" aria-label="Fechar menu" onClick={()=>setOpen(false)}/>}
    <aside className={open?"sidebar open":"sidebar"}>
      <Link className="brand" href={store && !allowed("executive")?"/pdv":"/"}><img className="sidebar-logo" src={store?.logo?"/marca/"+store.logo+"?v=2":"/executivo-empresarial.jpg"} alt={store?.name || "Executivo Empresarial"}/></Link>
      <button className="mobile-close icon-button" onClick={()=>setOpen(false)} aria-label="Fechar menu"><X size={20}/></button>
      <details className="store-switch"><summary><span className="store-icon"><StoreIcon size={17}/></span><span><b>{store?.name ?? "Minha loja"}</b><small>Ambiente da loja</small></span><ChevronsUpDown size={15} className="switch-arrows"/></summary>
        <div className="switch-menu">{stores.filter(s=>s.available).map(s=><form key={s.id} action={chooseStore}><button name="store" value={s.id}>{s.name}</button></form>)}
          </div>
      </details>
      <div className="nav-title">MENU PRINCIPAL</div>
      <nav className="nav-list" aria-label="Menu principal">{visible.filter(link=>!administration.includes(link.href)).map(({href,title,icon:Icon})=><Link title={title} key={href} href={href} onClick={()=>setOpen(false)} className={pathname===href?"active":""}><Icon size={18}/><span>{title}</span></Link>)}</nav>
      {visible.some(link=>link.href==="/funcionarios") && <><div className="nav-title administration">ADMINISTRAÇÃO</div><nav className="nav-list" aria-label="Administração">{visible.filter(link=>administration.includes(link.href)).map(({href,title,icon:Icon})=><Link title={title} key={href} href={href} onClick={()=>setOpen(false)} className={pathname===href?"active":""}><Icon size={18}/><span>{title}</span></Link>)}</nav></>}
      <div className="sidebar-bottom"><span className="status-dot"/><span>Executivo Empresarial <small>v1.0</small></span></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="crumb"><button className="icon-button desktop-toggle" aria-label="Alternar menu lateral" onClick={()=>setCollapsed(!collapsed)}><PanelLeft size={18}/></button><button className="icon-button mobile-toggle" aria-label="Abrir menu" onClick={()=>setOpen(!open)}><Menu size={21}/></button><span className="crumb-divider"/><span>{current?.title ?? "Empresa"}</span></div>
        <div className="account-tools">{store?.logo && <img className="top-logo" src={"/marca/"+store.logo+"?v=2"} alt={store.name}/>}{store && <Notifications key={store.id} store={store.id}/>}<div className="profile"><button className="profile-button" aria-expanded={menu} onClick={()=>setMenu(!menu)}><span className="avatar">{email?.slice(0,2).toUpperCase() ?? "EE"}</span><span className="profile-copy"><b>{store?.displayName || email?.split("@")[0] || "Minha conta"}</b><small>{store ? roles[store.role] : "Acesso à plataforma"}</small></span><ChevronDown size={15}/></button>
        {menu && <div className="profile-menu">{master && <Link href="/master"><ShieldCheck size={16}/> Painel master</Link>}{email?<form action={logout}><button><LogOut size={16}/> Sair</button></form>:<Link href="/login"><LogIn size={16}/> Entrar ou criar conta</Link>}</div>}</div></div>
      </header>
      <main className="main">{children}</main>
    </div>
  </div>
}
