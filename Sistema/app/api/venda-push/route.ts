import {cookies} from "next/headers"
import {session} from "@/lib/supabase"
import {pushCookie,pushEnabled,pushPublicKey,supportedPushEndpoint} from "@/lib/sale-push"

export async function GET() {
  const auth = pushEnabled ? await session() : null
  const endpoint = (await cookies()).get(pushCookie)?.value
  const active = auth?.store && endpoint ? await auth.db.rpc("has_sale_push",{s:auth.store.id,destination:endpoint}) : null
  return Response.json({key:auth?.store ? pushPublicKey : null,active:active?.data===true},{headers:{"Cache-Control":"private, no-store"}})
}

export async function POST(request:Request) {
  const auth = await session()
  if (!auth?.store || request.headers.get("sec-fetch-site")==="cross-site") return new Response(null,{status:403})
  const body = await request.json().catch(()=>null)
  if (body?.store!==auth.store.id || typeof (body.endpoint ?? (await cookies()).get(pushCookie)?.value)!=="string") return new Response(null,{status:400})
  const endpoint = body.endpoint ?? (await cookies()).get(pushCookie)?.value
  if (endpoint.length>1500 || !supportedPushEndpoint(endpoint)) return new Response(null,{status:400})
  if (body.enabled===false) {
    const {error} = await auth.db.rpc("unregister_sale_push",{destination:endpoint,s:auth.store.id})
    return new Response(null,{status:error?503:204})
  }
  if (!pushEnabled) return new Response(null,{status:503})
  const p256dh = body.keys?.p256dh
  const key = body.keys?.auth
  if (typeof p256dh!=="string" || !/^[\w-]{87}$/.test(p256dh) || typeof key!=="string" || !/^[\w-]{22}$/.test(key)) return new Response(null,{status:400})
  const {error} = await auth.db.rpc("register_sale_push",{s:auth.store.id,subscription:{endpoint,keys:{p256dh,auth:key}}})
  if (error) return new Response(null,{status:503})
  ;(await cookies()).set(pushCookie,endpoint,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:31536000})
  return new Response(null,{status:204})
}
