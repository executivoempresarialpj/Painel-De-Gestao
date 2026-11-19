"use client"
import {useEffect,useRef,useState} from "react"
import Link from "next/link"
import {Barcode,CheckCircle2,Minus,Package,Plus,Search,ShoppingCart,Trash2} from "lucide-react"
import {checkout,findProducts} from "@/app/actions"
import {Button} from "@/components/ui/button"
import {Card} from "@/components/ui/card"
import type {Product} from "@/lib/models"
import {brl,num,paymentLabels,dayIn} from "@/lib/utils"

type Line={product:Product;quantity:string}
type Attempt={day?:string;customer?:string;key:string;cart:Line[];discount:string;payment:string}
const cash=(n:number)=>BigInt(Math.round(n*100))
const lineTotal=(line:Line)=>Number((cash(line.product.price)*BigInt(Math.round((Number(line.quantity)||0)*1000))+BigInt(500))/BigInt(1000))/100

export function Pos({store,initial,user,zone}:{zone:string;store:string;initial:Product[];user:string}) {
  const searchField=useRef<HTMLInputElement>(null)
  useEffect(()=>{
    function focusSearch(event:KeyboardEvent){
      if(event.key==="F2"){event.preventDefault();searchField.current?.focus();searchField.current?.select()}
    }
    window.addEventListener("keydown",focusSearch)
    return ()=>window.removeEventListener("keydown",focusSearch)
  },[])
  const storageKey="varejo-pending:"+store+":"+user
  const [products,setProducts]=useState(initial)
  const [query,setQuery]=useState("")
  const [cart,setCart]=useState<Line[]>([])
  const [day,setDay]=useState(()=>dayIn(zone))
  const [customer,setCustomer]=useState("")
  const [payment,setPayment]=useState("cash")
  const [discount,setDiscount]=useState("0")
  const [error,setError]=useState("")
  const [searchError,setSearchError]=useState("")
  const [pending,setPending]=useState(false)
  const [attempt,setAttempt]=useState<Attempt|null>(null)
  const [done,setDone]=useState<{id:string;number:number;total:number;status:string}|null>(null)
  const inFlight=useRef(false)
  const subtotal=cart.reduce((sum,line)=>sum+Math.round(lineTotal(line)*100),0)/100
  const total=(Math.round(subtotal*100)-Math.round((Number(discount)||0)*100))/100
  const locked=pending || attempt!==null
  useEffect(()=>{
    try {
      const raw=sessionStorage.getItem(storageKey)
      if(raw) {
        const saved=JSON.parse(raw) as Attempt
        setDay(saved.day ?? dayIn(zone));setCustomer(saved.customer ?? "");setAttempt(saved);setCart(saved.cart);setDiscount(saved.discount);setPayment(saved.payment)
        setError("Há uma venda aguardando confirmação. Confirme o envio para recuperar o resultado.")
      }
    } catch { /* A tentativa continua disponível na memória durante a sessão atual. */ }
  },[storageKey])
  useEffect(()=>{
    if(!query.trim()) {setProducts(initial);setSearchError("");return}
    let active=true
    const timer=setTimeout(async ()=>{
      try {
        const result=await findProducts(store,query)
        if(active) {setProducts(result.products ?? []);setSearchError(result.error ?? "")}
      } catch {if(active) setSearchError("Falha ao buscar produtos. Tente novamente.")}
    },180)
    return ()=>{active=false;clearTimeout(timer)}
  },[query,store,initial])
  function add(product:Product) {
    if(locked || product.stock<=0) return
    setDone(null)
    setCart(previous=>{
      const existing=previous.find(line=>line.product.id===product.id)
      const increment=Math.min(1,product.stock)
      if(!existing) return [...previous,{product,quantity:String(increment)}]
      return previous.map(line=>line===existing?{product,quantity:String(Math.min(product.stock,Math.round((Number(line.quantity)+increment)*1000)/1000))}:line)
    })
  }
  async function scan(code:string) {
    if(!code.trim() || locked) return
    try {
      const result=await findProducts(store,code)
      const matches=result.products ?? []
      const match=matches.find(p=>p.barcode===code) ?? matches.find(p=>p.sku.toLowerCase()===code.toLowerCase()) ?? (matches.length===1?matches[0]:undefined)
      if(!match || match.stock===0) {setSearchError(result.error ?? "Produto indisponível ou código não encontrado.");return}
      add(match);setQuery("");setSearchError("")
    } catch {setSearchError("Falha ao buscar o código. Tente novamente.")}
  }
  function quantity(id:string,amount:string) {
    setCart(previous=>previous.map(line=>line.product.id===id?{...line,quantity:amount}:line))
  }
  async function submit(event:React.FormEvent) {
    event.preventDefault()
    if(inFlight.current) return
    if(!attempt && (!cart.length || total<0 || cart.some(line=>Number(line.quantity)<=0 || Number(line.quantity)>line.product.stock))) {
      setError("Confira as quantidades disponíveis e o desconto.");return
    }
    const request=attempt ?? {key:crypto.randomUUID(),cart,discount,payment,customer,day}
    inFlight.current=true;setPending(true);setAttempt(request);setError("")
    try {sessionStorage.setItem(storageKey,JSON.stringify(request))} catch {}
    try {
      const result=await checkout(store,request.key,request.cart.map(line=>({id:line.product.id,quantity:line.quantity})),request.discount||"0",request.payment,request.customer,request.day)
      if(result.error) {
        setError(result.error)
        if(result.retry) return
      } else if(result.sale) {
        window.dispatchEvent(new Event("stock-changed"));setDone(result.sale);setDay(dayIn(zone));setCustomer("");setCart([]);setDiscount("0")
      }
      try {sessionStorage.removeItem(storageKey)} catch {}
      setAttempt(null)
    } catch {setError("A conexão foi interrompida. Reenvie a mesma venda para confirmar o resultado.")}
    finally {inFlight.current=false;setPending(false)}
  }
  return <div className="pos-grid">
    <Card className="panel"><h2>Produtos disponíveis</h2>
      <form className="search-row" onSubmit={e=>{e.preventDefault();void scan(query.trim())}}><Search size={18}/><input ref={searchField} autoFocus placeholder="Buscar por nome, SKU ou código de barras (F2)" aria-label="Buscar produto ou ler código de barras" value={query} onChange={e=>setQuery(e.target.value)}/><Button type="submit" variant="ghost" title="Localizar código"><Barcode size={20}/></Button></form>
      {searchError && <p role="alert" className="error">{searchError}</p>}
      {!products.length && <p className="empty">Nenhum produto encontrado.</p>}
      <div className="pos-products">{products.map(product=><button className="pos-product" key={product.id} onClick={()=>add(product)} disabled={locked || product.stock<=0}>
        <span className="metric-icon blue"><Package size={18}/></span><span><b>{product.name}</b><small>{product.sku} · {num(product.stock)} {product.unit}</small></span><strong>{brl(product.price)}</strong><Plus size={17}/></button>)}</div>
    </Card>
    <Card className="panel checkout"><h2><ShoppingCart size={20}/> Carrinho {cart.length>0 && <small>· {cart.length} produtos</small>}</h2>
      {done && <div className="sale-confirm" role="status"><CheckCircle2 size={22}/><div><b>Venda #{done.number} {done.status==="cancelled"?"cancelada":"confirmada"}</b><p>{brl(done.total)}</p><Link href={"/vendas?sale="+done.id}>Ver detalhes</Link></div></div>}
      {!cart.length && <div className="empty">Adicione um produto para iniciar a venda.</div>}
      <form onSubmit={submit}>
        {cart.map(({product,quantity:amount})=><div className="cart-line" key={product.id}><div><b>{product.name}</b><small>{brl(product.price)} / {product.unit} · Total {brl(lineTotal({product,quantity:amount}))}</small></div><div className="stepper">
          <Button type="button" variant="ghost" disabled={locked || Number(amount)<=1} onClick={()=>quantity(product.id,String(Math.max(.001,Number(amount)-1)))} aria-label="Diminuir quantidade"><Minus size={14}/></Button>
          <input aria-label={"Quantidade de "+product.name} type="number" min=".001" max={product.stock} step=".001" required disabled={locked} value={amount} onChange={e=>quantity(product.id,e.target.value)}/>
          <Button type="button" variant="ghost" disabled={locked || Number(amount)>=product.stock} onClick={()=>quantity(product.id,String(Math.min(product.stock,Math.round((Number(amount)+1)*1000)/1000)))} aria-label="Aumentar quantidade"><Plus size={14}/></Button>
        </div><Button type="button" variant="ghost" disabled={locked} aria-label={"Remover "+product.name} onClick={()=>setCart(cart.filter(line=>line.product.id!==product.id))}><Trash2 size={16}/></Button></div>)}
        <label>Data da venda<input type="date" required value={day} max={dayIn(zone)} disabled={locked} onChange={e=>setDay(e.target.value)}/></label><label>Cliente (opcional)<input maxLength={120} value={customer} disabled={locked} onChange={e=>setCustomer(e.target.value)}/></label><div className="checkout-totals"><div><span>Subtotal</span><b>{brl(subtotal)}</b></div><label>Desconto (R$)<input type="number" min="0" max={subtotal} step=".01" value={discount} disabled={locked} onChange={e=>setDiscount(e.target.value)}/></label><div className="total"><span>Total</span><strong>{brl(total)}</strong></div></div>
        <label>Forma de pagamento<select value={payment} disabled={locked} onChange={e=>setPayment(e.target.value)}>{Object.entries(paymentLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        {error && <p role="alert" className="error">{error}</p>}
        <Button disabled={pending || !cart.length} className="finish">{pending?"Confirmando…":attempt?"Confirmar envio":"Finalizar venda"}</Button>
      </form>
    </Card>
  </div>
}
