import Link from "next/link"
import { ArrowLeft, Store } from "lucide-react"
import { AuthForm } from "@/components/form"
import { configured } from "@/lib/supabase"
export default function Login() {
  return <main className="auth-page"><section className="card auth-card">
    <Link href="/gestor" className="auth-back">Acesso do gestor</Link>
    <img className="login-logo" src="/executivo-empresarial.jpg" alt="Logo Executivo Empresarial"/>
    <h1>Executivo Empresarial</h1><p>Entre com seu e-mail e senha. Novos acessos precisam de autorização.</p>
    {!configured && <p className="notice">Conecte um projeto Supabase para ativar o cadastro e o acesso.</p>}
    <AuthForm/>
  </section></main>
}
