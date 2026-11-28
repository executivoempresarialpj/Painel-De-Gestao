import {createClient} from "@supabase/supabase-js"
import {sendNotification,type PushSubscription} from "web-push"
import {brl} from "@/lib/utils"

export const pushPublicKey = process.env.VAPID_PUBLIC_KEY?.trim()
const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
const subject = process.env.VAPID_SUBJECT?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
export const pushEnabled = Boolean(pushPublicKey && privateKey && subject && serviceKey && process.env.NEXT_PUBLIC_SUPABASE_URL)
export const pushCookie = "sale_push_endpoint"

export async function sendSalePush(subscription:PushSubscription,message:string) {
  if (!pushEnabled || !supportedPushEndpoint(subscription.endpoint)) throw new Error("Push indisponível")
  return sendNotification(subscription,message,{
    TTL:86400,timeout:5000,urgency:"high",vapidDetails:{subject:subject!,publicKey:pushPublicKey!,privateKey:privateKey!}
  })
}

export function supportedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint)
    const host = url.hostname
    return url.protocol === "https:" && !url.port && !url.username && !url.password &&
      (host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" ||
       host === "web.push.apple.com" || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com"))
  } catch { return false }
}

export async function notifySale(store: {id:string;name:string}, sale: {id:string;total:number}) {
  if (!pushEnabled) return
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey!, {auth:{persistSession:false,autoRefreshToken:false}})
  const {data,error} = await admin.rpc("claim_sale_push",{s:store.id,sale:sale.id})
  if (error) throw new Error(error.message)
  const message = JSON.stringify({id:sale.id,title:"Venda realizada",body:store.name+" · "+brl(sale.total)})
  await Promise.all((data as PushSubscription[]).map(async subscription => {
    if (!supportedPushEndpoint(subscription.endpoint)) return
    try {
      await sendSalePush(subscription,message)
    } catch (error) {
      const status = (error as {statusCode?:number}).statusCode
      if (status===404 || status===410) await admin.rpc("remove_expired_sale_push",{destination:subscription.endpoint})
      else console.warn("Notificação de venda não entregue",status ?? "conexão")
    }
  }))
}
