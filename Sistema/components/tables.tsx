import Link from "next/link"
import {ChevronLeft,ChevronRight,Package,Search} from "lucide-react"
import {Card} from "@/components/ui/card"
import {brl,movementLabels,num,showDate} from "@/lib/utils"
import type {Product,Movement} from "@/lib/models"
import type {Query} from "@/lib/report"
import {ProductForm} from "@/components/store-forms"
import type {Store} from "@/lib/supabase"
export const currentPage=(q:Query)=>Math.max(0,Math.min(100000,Math.trunc(Number(q.page)||0)))
export function Pagination({query,more}:{query:Query;more:boolean}) {
  const page=currentPage(query)
  const url=(target:number)=>{
    const params=new URLSearchParams()
    for(const [key,value] of Object.entries(query)) if(value && key!=="page") params.set(key,value)
    params.set("page",String(target))
    return "?"+params.toString()
  }
  if(!more && page===0)return null
  return <div className="pagination">{page>0 && <Link className="button outline" href={url(page-1)}><ChevronLeft size={16}/> Anterior</Link>}<span>Página {page+1}</span>{more && <Link className="button outline" href={url(page+1)}>Próxima <ChevronRight size={16}/></Link>}</div>
}
export function SearchForm({children,query,placeholder="Buscar por nome ou código"}:{children?:React.ReactNode;query?:string;placeholder?:string}) {
  return <form className="filters"><label className="filter-search"><Search size={17}/><input name="q" defaultValue={query} placeholder={placeholder} aria-label={placeholder}/></label>{children}<button className="button outline">Filtrar</button></form>
}
export function ProductTable({products,store,edit=false,adjust=false}:{products:Product[];store:Store;edit?:boolean;adjust?:boolean}) {
  if(!products.length)return <p className="empty">Nenhum produto encontrado.</p>
  const costs=products.some(p=>p.cost!==undefined)
  return <div className="table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th>{costs && <th>Custo</th>}{store.mode!=="services" && <th>Preço de venda</th>}{store.mode!=="services" && costs && <th>Lucro bruto / unidade</th>}<th>Estoque</th><th>Status</th>{(edit||adjust) && <th>Ações</th>}</tr></thead><tbody>
    {products.map(p=><tr key={p.id}><td><div className="table-product">{p.image_url && /^https?:\/\//.test(p.image_url)?<img src={p.image_url} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<span className="metric-icon blue"><Package size={16}/></span>}<div><b>{p.name}</b><small>{p.sku}{p.barcode?" · "+p.barcode:""}</small></div></div></td><td>{p.category || "—"}</td>{costs && <td>{p.cost===undefined?"—":brl(p.cost)}</td>}{store.mode!=="services" && <td>{brl(p.price)}</td>}{store.mode!=="services" && costs && <td>{p.cost===undefined?"—":brl((Math.round(p.price*100)-Math.round(p.cost*100))/100)}</td>}<td>{num(p.stock)} {p.unit}<small>Mínimo {num(p.minimum)}</small></td><td><span className={"badge "+(!p.active?"neutral":p.stock===0?"red":p.stock<=p.minimum?"amber":"green")}>{!p.active?"Inativo":p.stock===0?"Esgotado":p.stock<=p.minimum?"Estoque baixo":"Ativo"}</span></td>
    {(edit||adjust) && <td>{edit?<Link className="text-link" href={"?edit="+p.id}>Editar</Link>:<Link className="text-link" href={"?adjust="+p.id}>Movimentar</Link>}</td>}</tr>)}
  </tbody></table></div>
}
export function EditProduct({store,product}:{store:Store;product?:Product}) {
  return <Card className="panel"><div className="panel-heading"><h2>{product?"Editar produto":"Novo produto"}</h2><Link className="text-link" href="/produtos">Fechar</Link></div><ProductForm services={store.mode==="services"} store={store.id} product={product} minimum={store.minimum} unit={store.unit}/></Card>
}
export function MovementTable({rows,zone}:{rows:Movement[];zone:string}) {
  if(!rows.length)return <p className="empty">Nenhuma movimentação encontrada.</p>
  return <div className="table-wrap"><table><thead><tr><th>Data e hora</th><th>Produto</th><th>Tipo</th><th>Quantidade</th><th>Saldo anterior</th><th>Saldo final</th><th>Responsável</th><th>Motivo</th></tr></thead><tbody>{rows.map(m=><tr key={m.id}><td>{showDate(m.created_at,zone)}</td><td>{m.product}</td><td>{movementLabels[m.kind]}</td><td className={m.quantity>0?"positive":"negative"}>{m.quantity>0?"+":""}{num(m.quantity)}</td><td>{num(m.previous)}</td><td>{num(m.balance)}</td><td>{m.operator}</td><td>{m.reason || "—"}</td></tr>)}</tbody></table></div>
}
