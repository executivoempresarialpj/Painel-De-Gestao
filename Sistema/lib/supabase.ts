import { createServerClient } from "@supabase/ssr"
import { cache } from "react"
import { cookies } from "next/headers"
export const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
export async function database(writable=false) {
  const jar = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: values => { try { values.forEach(({name,value,options}) => jar.set(name,value,options)) } catch (error) { if(writable)throw error; /* Proxy refreshes cookies on reads. */ } }
    }
  })
}
export type Store = { mode?:"services"|"retail";logo?:string; id:string; name:string; role:"owner"|"manager"|"cashier"; permissions:string[]; displayName?:string; minimum?:number; unit?:string; timezone:string; available:boolean }
export type StoreContext = {master:boolean;stores:Store[]}
export const can = (store:Store, permission:string) => store.role==="owner" || (store.role==="manager" && store.permissions.includes(permission))
export const session = cache(async () => {
  if (!configured) return null
  const db = await database()
  const {data:verified}=await db.auth.getClaims()
  if (!verified?.claims.sub) return null
  const user={id:verified.claims.sub,email:verified.claims.email as string|undefined}
  const {data,error} = await db.rpc("store_context")
  if (error) throw new Error(error.message)
  const context = data as StoreContext
  const selected = (await cookies()).get("varejo_store")?.value
  const store = context.stores.find(item => item.id===selected && item.available) ?? context.stores.find(item=>item.available)
  return {db,user,context,store}
})
