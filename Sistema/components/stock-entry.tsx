"use client"

import {useMemo,useRef,useState,useTransition} from "react"
import {ArrowDownToLine,Boxes,CheckCircle2,Package,Search,Trash2} from "lucide-react"
import {receiveManualStock} from "@/app/actions"
import {Card} from "@/components/ui/card"
import {num} from "@/lib/utils"
import type {Product} from "@/lib/models"

const norm=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim()
const valid=(v:string)=>/^[0-9]{1,11}(\.[0-9]{1,3})?$/.test(v)&&Number(v)>0
const normalizeQty=(v:string)=>v.trim().replace(",",".")
const rounded=(n:number)=>Math.round(n*1000)/1000
export function StockEntry({store,products}:{store:string;products:Product[]}){
  const [q,setQ]=useState(""),[filter,setFilter]=useState("all"),[draft,setDraft]=useState<Record<string,string>>({})
  const [pending,startTransition]=useTransition()
  const [feedback,setFeedback]=useState<{error?:string;message?:string}>({})
  const [retryLocked,setRetryLocked]=useState(false)
  const request=useRef<{reference:string;lines:string}|null>(null)
  const busy=useRef(false)
  const chosen=useMemo(()=>products.filter(p=>p.active && !!draft[p.id]?.trim()),[products,draft])
  const validLines=chosen.every(p=>valid(normalizeQty(draft[p.id])))
  const low=products.filter(p=>p.active && p.stock<=p.minimum).length
  const empty=products.filter(p=>p.active && p.stock===0).length
  const visible=products.filter(p=>{
    const matches=norm([p.name,p.sku,p.barcode||"",p.category||""].join(" ")).includes(norm(q))
    return matches && (filter==="all" || filter==="low"&&p.active&&p.stock<=p.minimum || filter==="empty"&&p.active&&p.stock===0 || filter==="selected"&&!!draft[p.id]?.trim())
  })
  const update=(id:string,value:string)=>{if(busy.current||retryLocked)return;setDraft(d=>({...d,[id]:value}));setFeedback({})}
  function confirm(){
    if(busy.current||!chosen.length||!validLines||chosen.length>250)return
    busy.current=true;setFeedback({})
    const lines=JSON.stringify(chosen.map(p=>({sku:p.sku,quantity:normalizeQty(draft[p.id])})).sort((a,b)=>a.sku.localeCompare(b.sku)))
    if(!request.current)request.current={reference:"Entrada manual "+crypto.randomUUID(),lines}
    const payload=request.current
    startTransition(async()=>{
      try{
        const result=await receiveManualStock(store,payload.reference,payload.lines)
        if(result.error){setFeedback({error:result.error});setRetryLocked(!!result.retry);if(!result.retry)request.current=null;return}
        setDraft({});request.current=null;setRetryLocked(false);setFeedback({message:result.message||"Entrada registrada."})
      }catch{setFeedback({error:"Não foi possível confirmar a resposta. Tente novamente para verificar a mesma entrada sem duplicá-la."});setRetryLocked(true)}
      finally{busy.current=false}
    })
  }
  function clear(){if(busy.current||retryLocked)return;setDraft({});request.current=null;setFeedback({})}
  return <>
    <div className="entry-metrics">
      <Card className="entry-metric"><span className="metric-icon blue"><Package size={20}/></span><div><small>Produtos cadastrados</small><strong>{num(products.length)}</strong></div></Card>
      <Card className="entry-metric"><span className="metric-icon amber"><Boxes size={20}/></span><div><small>Estoque baixo (inclui zerados)</small><strong>{num(low)}</strong></div></Card>
      <Card className="entry-metric"><span className="metric-icon red"><Package size={20}/></span><div><small>Esgotados</small><strong>{num(empty)}</strong></div></Card>
      <Card className="entry-metric"><span className="metric-icon green"><ArrowDownToLine size={20}/></span><div><small>Produtos para repor</small><strong>{num(chosen.length)}</strong></div></Card>
    </div>
    <Card className="panel entry-panel">
      <div className="entry-panel-head"><div><h2>Reposição de estoque</h2><p className="muted">Digite apenas a quantidade que chegou. O sistema soma ao saldo existente.</p></div><span className="entry-count">{visible.length} de {products.length} produtos</span></div>
      <div className="entry-tools"><label className="filter-search"><Search size={18}/><input aria-label="Buscar produto" placeholder="Buscar nome, SKU, código ou categoria…" value={q} onChange={e=>setQ(e.target.value)}/></label>
      <select aria-label="Filtrar produtos" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todos os produtos</option><option value="low">Estoque baixo</option><option value="empty">Esgotados</option><option value="selected">Selecionados</option></select></div>
      <div className="entry-list" role="list">
        <div className="entry-table-head" aria-hidden="true"><span>Produto</span><span>Saldo atual</span><span>Adicionar</span><span>Novo saldo</span></div>
        {!visible.length && <p className="empty">Nenhum produto encontrado.</p>}
        {visible.map(p=>{const qty=draft[p.id]||"",value=normalizeQty(qty),good=valid(value);return <div role="listitem" key={p.id} className={"entry-row"+(good?" entry-selected":"")}>
          <div className="entry-product"><span className="metric-icon blue"><Package size={19}/></span><div><b>{p.name}</b><small>{p.sku}{p.category?" · "+p.category:""}</small>{!p.active&&<span className="badge neutral">Inativo</span>}</div></div>
          <div className="entry-balance"><small>Saldo atual</small><strong>{num(p.stock)} <span>{p.unit}</span></strong></div>
          <label className="entry-qty"><span>Adicionar ({p.unit})</span><input inputMode="decimal" aria-label={"Quantidade a adicionar: "+p.name} placeholder="0" value={qty} disabled={!p.active||pending||retryLocked} onChange={e=>update(p.id,e.target.value)} aria-invalid={!!qty.trim()&&!good}/></label>
          <div className="entry-balance entry-after"><small>Novo saldo estimado</small><strong>{num(rounded(p.stock+(good?Number(value):0)))} <span>{p.unit}</span></strong></div>
        </div>})}
      </div>
      <div className="entry-footer"><div><strong>{chosen.length} produto(s) selecionado(s)</strong><p className="muted">{chosen.length?"Confira as quantidades e os novos saldos antes de confirmar.":"Nenhuma quantidade informada"}</p></div><div className="inline-actions"><button type="button" className="button outline" onClick={clear} disabled={pending||retryLocked||!chosen.length}><Trash2 size={16}/> Limpar</button><button type="button" className="button default" onClick={confirm} disabled={pending||!chosen.length||!validLines||chosen.length>250}><CheckCircle2 size={17}/>{pending?"Registrando…":retryLocked?"Confirmar mesma entrada":"Confirmar entrada"}</button></div></div>
      {!validLines&&<p role="alert" className="error">Informe quantidades positivas, com até três casas decimais.</p>}
      {chosen.length>250&&<p role="alert" className="error">Registre até 250 produtos por entrada.</p>}
      {feedback.error&&<p role="alert" className="error">{feedback.error}{retryLocked?" Recarregue para corrigir, ou confirme novamente para consultar a mesma entrada.":""}</p>}
      {feedback.message&&<p role="status" className="success">{feedback.message}</p>}
    </Card>
  </>
}
