"use client"

import {useEffect,useState} from "react"
import {Card} from "@/components/ui/card"

type Config = {key:string;active:boolean}
type Support = "checking"|"supported"|"install"|"unsupported"

function publicKeyBytes(key:string) {
  const normalized=key.replace(/-/g,"+").replace(/_/g,"/")
  const raw=atob(normalized+"=".repeat((4-normalized.length%4)%4))
  const bytes=new Uint8Array(raw.length)
  for(let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i)
  return bytes
}

async function workerReady() {
  await navigator.serviceWorker.register("/sale-push-worker.js")
  return new Promise<ServiceWorkerRegistration>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("O serviço de notificações demorou a iniciar. Tente novamente.")),10000)
    navigator.serviceWorker.ready.then(registration=>{clearTimeout(timer);resolve(registration)},error=>{clearTimeout(timer);reject(error)})
  })
}

async function responseMessage(response:Response) {
  const body=await response.json().catch(()=>null)
  return typeof body?.message==="string" ? body.message : "Não foi possível comunicar com o servidor. Tente novamente."
}

export function SaleAlerts({store}:{store:string}) {
  const [config,setConfig]=useState<Config|null>(null)
  const [status,setStatus]=useState("")
  const [loadError,setLoadError]=useState("")
  const [busy,setBusy]=useState(false)
  const [support,setSupport]=useState<Support>("checking")
  const [revision,setRevision]=useState(0)

  useEffect(()=>{
    const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1)
    const standalone=window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & {standalone?:boolean}).standalone===true
    const supported="serviceWorker" in navigator && "PushManager" in window && "Notification" in window
    setSupport(ios&&!standalone?"install":supported?"supported":"unsupported")
    if(supported && (!ios || standalone)) navigator.serviceWorker.register("/sale-push-worker.js").catch(()=>{})
  },[])

  useEffect(()=>{
    const controller=new AbortController()
    setConfig(null)
    setLoadError("")
    async function load() {
      try {
        const response=await fetch("/api/venda-push",{signal:controller.signal,credentials:"same-origin",cache:"no-store"})
        if(!response.ok) throw new Error(await responseMessage(response))
        const data=await response.json()
        if(typeof data.key!=="string" || !data.key) throw new Error("O servidor não disponibilizou a chave de notificações.")
        let active=data.active===true
        if(active && "serviceWorker" in navigator && "Notification" in window) {
          const registration=await navigator.serviceWorker.getRegistration()
          active=Notification.permission==="granted" && !!(await registration?.pushManager.getSubscription())
        }
        if(!controller.signal.aborted) setConfig({key:data.key,active})
      } catch(error) {
        if(!controller.signal.aborted) setLoadError(error instanceof Error?error.message:"Não foi possível consultar as notificações.")
      }
    }
    void load()
    return ()=>controller.abort()
  },[store,revision])

  async function toggle() {
    if(!config || busy || support!=="supported") return
    setBusy(true)
    setStatus("")
    try {
      if(!config.active) {
        const permission=await Notification.requestPermission()
        if(permission!=="granted") throw new Error("Permita as notificações nas configurações do aparelho e tente novamente.")
      }
      const {pushManager}=await workerReady()
      let subscription=await pushManager.getSubscription()
      if(!config.active) {
        const bytes=publicKeyBytes(config.key)
        if(subscription?.options.applicationServerKey) {
          const previous=new Uint8Array(subscription.options.applicationServerKey)
          if(previous.length!==bytes.length || previous.some((value,index)=>value!==bytes[index])) {
            await subscription.unsubscribe()
            subscription=null
          }
        }
        if(!subscription) subscription=await pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes})
      }
      const response=await fetch("/api/venda-push",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...subscription?.toJSON(),store,enabled:!config.active})
      })
      if(!response.ok) throw new Error(await responseMessage(response))
      setConfig({...config,active:!config.active})
      setStatus(config.active?"Avisos desativados nesta loja.":"Avisos ativados neste aparelho.")
    } catch(error) {
      setStatus(error instanceof Error?error.message:"Não foi possível alterar os avisos.")
    } finally {setBusy(false)}
  }

  async function test() {
    if(!config?.active || busy) return
    setBusy(true)
    setStatus("")
    try {
      const registration=await workerReady()
      const subscription=await registration.pushManager.getSubscription()
      if(!subscription) {
        setConfig({...config,active:false})
        throw new Error("Registro do aparelho não encontrado. Ative novamente.")
      }
      const response=await fetch("/api/venda-push",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...subscription.toJSON(),store,action:"test"})
      })
      const message=await responseMessage(response)
      if(response.status===410 || response.status===409 || response.status===403) setConfig({...config,active:false})
      if(!response.ok) throw new Error(message)
      setStatus(message)
    } catch(error) {
      setStatus(error instanceof Error?error.message:"Não foi possível enviar o teste.")
    } finally {setBusy(false)}
  }

  return <Card className="panel">
    <h2>Notificações de venda</h2>
    <p className="muted">Receba um aviso com o valor da venda neste aparelho, inclusive com o aplicativo fechado.</p>
    {support==="install" && <p>No iPhone, abra pelo Safari, toque em Compartilhar, escolha Adicionar à Tela de Início e abra pelo ícone para ativar.</p>}
    {support==="unsupported" && <p>Este navegador não oferece suporte a notificações push. Use um navegador compatível.</p>}
    {loadError ? <div>
      <p role="alert" className="muted">{loadError}</p>
      <button type="button" className="button outline" onClick={()=>setRevision(value=>value+1)}>Tentar novamente</button>
    </div> : !config ? <p className="muted">Verificando disponibilidade…</p> : support==="supported" && <div>
      <p className="muted">{config.active?"Notificações ativas neste aparelho.":"Notificações desativadas neste aparelho."}</p>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button type="button" className="button outline" onClick={toggle} disabled={busy}>{busy?"Aguarde…":config.active?"Desativar neste aparelho":"Receber notificações"}</button>
        {config.active && <button type="button" className="button outline" onClick={test} disabled={busy}>Enviar notificação de teste</button>}
      </div>
    </div>}
    {status && <p role="status" aria-live="polite" className="muted">{status}</p>}
  </Card>
}
