import {redirect} from "next/navigation"
import {configured,database} from "@/lib/supabase"
import {AuthForm} from "@/components/form"
export default async function Manager(){
 if(configured && (await (await database()).rpc("manager_access")).data===true) redirect("/master")
 return <main className="auth-page"><section className="card auth-card"><img className="login-logo" src="/executivo-empresarial.jpg" alt="Executivo Empresarial"/><h1>Acesso do gestor</h1><AuthForm manager/></section></main>
}
