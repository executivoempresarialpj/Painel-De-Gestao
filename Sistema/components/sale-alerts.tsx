"use client"

import {useEffect,useState} from "react"

export function SaleAlerts({store}:{store:string}) {
  const [config,setConfig] = useState<{key:string;active:boolean}|null>(null)
  const [status,setStatus] = useState("")
  const [busy,setBusy] = useState(false)
  const [supported,setSupported] = useState(false)

  useEffect(()=>{
    setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window)
    const controller=new AbortController()
    fetch("/api/venda-push",{signal:controller.signal}).then(response=>response.json()).then(setConfig).catch(()=>{})
    return ()=>controller.abort()
  },[])

  async function toggle() {
    if (!config || busy) return
    setBusy(true)
    setStatus("")
    try {
      if (!config.active && await Notification.requestPermission()!=="granted") {
        setStatus("Permita as notificações nas configurações do celular.")
        return
      }
      await navigator.serviceWorker.register("/sale-push-worker.js")
      const {pushManager}=await navigator.serviceWorker.ready
      let subscription=await pushManager.getSubscription()
      if (!subscription && !config.active) subscription=await pushManager.subscribe({userVisibleOnly:true,applicationServerKey:config.key})
      const response=await fetch("/api/venda-push",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...subscription?.toJSON(),store,enabled:!config.active})
      })
      if (!response.ok) throw new Error("subscription")
      setConfig({...config,active:!config.active})
      setStatus(config.active?"Avisos desativados nesta loja.":"Avisos ativados neste aparelho.")
    } catch {
      setStatus("Não foi possível alterar os avisos. Confira as permissões e tente novamente.")
    } finally { setBusy(false) }
  }

  if (!config?.key) return null
  return <div className="sale-alert-settings">
    <h3>Notificações de venda</h3>
    {supported ? <button type="button" className="button outline" onClick={toggle} disabled={busy}>
      {busy?"Aguarde…":config.active?"Desativar neste aparelho":"Ativar neste aparelho"}
    </button> : <small>No iPhone, adicione o painel à Tela de Início e abra pelo ícone para ativar.</small>}
    {status && <small role="status">{status}</small>}
  </div>
}
