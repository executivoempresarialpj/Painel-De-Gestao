import {authCookieOptions} from "@/lib/auth-cookie"
import {createServerClient} from "@supabase/ssr"
import {NextResponse,type NextRequest} from "next/server"
export async function proxy(request:NextRequest) {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  let response=NextResponse.next({request})
  if (!url || !key || request.method==="POST" || !request.cookies.getAll().some(c=>c.name.startsWith("sb-"))) return response
  const db=createServerClient(url,key,{cookieOptions:authCookieOptions,cookies:{
    getAll:()=>request.cookies.getAll(),
    setAll(values) {
      values.forEach(({name,value})=>request.cookies.set(name,value))
      response=NextResponse.next({request})
      response.headers.set("Cache-Control","private, no-store")
      values.forEach(({name,value,options})=>response.cookies.set(name,value,options))
    }
  }})
  await db.auth.getClaims()
  return response
}
export const config={matcher:["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"]}
