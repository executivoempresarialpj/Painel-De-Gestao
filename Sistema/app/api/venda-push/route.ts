import {cookies} from "next/headers"
import {session} from "@/lib/supabase"
import {pushCookie,pushEnabled,pushPublicKey,supportedPushEndpoint,sendSalePush} from "@/lib/sale-push"
import {randomUUID} from "node:crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const headers = {"Cache-Control":"private, no-store"}
function failure(message:string,status:number) {
  return Response.json({message},{status,headers})
}

export async function GET() {
  try {
    const auth = await session()
    if (!auth?.store) return failure("Sua sessão ou loja não foi encontrada. Entre novamente.",401)
    if (!pushEnabled) {
      console.warn("Venda push: configuração de envio incompleta")
      return failure("O servidor de notificações ainda não está configurado.",503)
    }
    const endpoint = (await cookies()).get(pushCookie)?.value
    const active = endpoint ? await auth.db.rpc("has_sale_push",{s:auth.store.id,destination:endpoint}) : null
    if (active?.error) {
      console.warn("Venda push: falha ao consultar inscrição",active.error.code)
      return failure("Não foi possível consultar o registro deste aparelho. Tente novamente.",503)
    }
    return Response.json({key:pushPublicKey,active:active?.data===true},{headers})
  } catch {
    console.warn("Venda push: falha ao verificar disponibilidade")
    return failure("Não foi possível consultar o servidor de notificações.",503)
  }
}

export async function POST(request:Request) {
  try {
    if (request.headers.get("sec-fetch-site")==="cross-site") return failure("Solicitação não autorizada.",403)
    const auth = await session()
    if (!auth?.store) return failure("Sua sessão expirou. Entre novamente.",401)
    const body = await request.json().catch(()=>null)
    const jar = await cookies()
    if (!body || body.store!==auth.store.id) return failure("Loja inválida ou alterada. Atualize a página.",400)
    const endpoint = body.endpoint ?? jar.get(pushCookie)?.value
    if (typeof endpoint!=="string" || endpoint.length>1500 || !supportedPushEndpoint(endpoint)) return failure("Registro do aparelho inválido. Ative novamente.",400)
    if (body.enabled===false && body.action!=="test") {
      const {error} = await auth.db.rpc("unregister_sale_push",{destination:endpoint,s:auth.store.id})
      if (error) return failure("Não foi possível desativar os avisos.",503)
      jar.delete(pushCookie)
      return new Response(null,{status:204,headers})
    }
    if (!pushEnabled) return failure("O servidor de notificações ainda não está configurado.",503)
    const p256dh = body.keys?.p256dh
    const key = body.keys?.auth
    if (typeof p256dh!=="string" || !/^[\w-]{87}$/.test(p256dh) || typeof key!=="string" || !/^[\w-]{22}$/.test(key)) return failure("Chaves do aparelho inválidas. Ative novamente.",400)
    const subscription = {endpoint,keys:{p256dh,auth:key}}
    if (body.action==="test") {
      if (jar.get(pushCookie)?.value!==endpoint) return failure("Ative as notificações neste aparelho antes do teste.",403)
      const active = await auth.db.rpc("has_sale_push",{s:auth.store.id,destination:endpoint})
      if (active.error || active.data!==true) return failure("Registro não encontrado. Ative novamente.",409)
      try {
        await sendSalePush(subscription,JSON.stringify({id:randomUUID(),title:"Teste de notificação",body:auth.store.name+" · Notificações de venda funcionando."}))
        return Response.json({message:"Teste aceito pelo serviço de envio. Confira a notificação no aparelho."},{headers})
      } catch (error) {
        const status=(error as {statusCode?:number}).statusCode
        console.warn("Venda push: falha no teste",status ?? "conexão")
        if (status===404 || status===410) {
          await auth.db.rpc("unregister_sale_push",{destination:endpoint,s:auth.store.id})
          jar.delete(pushCookie)
          return failure("O registro expirou. Ative novamente.",410)
        }
        return failure("O serviço de envio recusou o teste. Tente novamente.",502)
      }
    }
    if (body.enabled!==true) return failure("Ação inválida.",400)
    const {error} = await auth.db.rpc("register_sale_push",{s:auth.store.id,subscription})
    if (error) {
      console.warn("Venda push: falha ao registrar aparelho",error.code)
      return failure("Não foi possível registrar o aparelho. Verifique o acesso à loja.",503)
    }
    jar.set(pushCookie,endpoint,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:31536000})
    return new Response(null,{status:204,headers})
  } catch {
    console.warn("Venda push: falha ao processar solicitação")
    return failure("Falha na comunicação com o servidor de notificações.",503)
  }
}
