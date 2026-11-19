import {redirect} from "next/navigation"
import { Shell } from "@/components/shell"
import { session } from "@/lib/supabase"
export default async function StoreLayout({children}:{children:React.ReactNode}) {
  const auth=await session()
  if(!auth) redirect("/login")
  if(!auth.store) redirect(auth.context.master?"/master":"/aguardando")
  return <Shell store={auth?.store} stores={auth?.context.stores ?? []} email={auth?.user.email} master={auth?.context.master ?? false}>{children}</Shell>
}

export async function generateMetadata(){
 const store=(await session())?.store
 return {appleWebApp:{capable:true,title:store?.name || "Executivo Empresarial"},icons:{apple:store?.logo?"/marca/"+store.logo+"?v=2":"/icone.png"},manifest:"/app-manifest"}
}
