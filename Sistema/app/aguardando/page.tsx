import {redirect} from "next/navigation"
import {session} from "@/lib/supabase"
import {logout} from "@/app/actions"
export default async function Pending(){
  const auth=await session()
  if(!auth) redirect("/login")
  if(auth.store) redirect("/")
  if(auth.context.master) redirect("/master")
  return <main className="auth-page"><section className="card auth-card"><h1>Acesso à loja</h1><p>Peça ao gestor para autorizar seu e-mail e ao proprietário para vincular sua conta à loja. Depois, atualize esta página.</p><form action={logout}><button className="button outline">Sair da conta</button></form></section></main>
}
