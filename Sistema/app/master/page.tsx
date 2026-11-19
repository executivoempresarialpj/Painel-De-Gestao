import Link from "next/link"
import {ShieldCheck,ArrowLeft,Building2} from "lucide-react"
import {logout} from "@/app/actions"
import {configured,database} from "@/lib/supabase"
import {Heading} from "@/components/report-view"
import {ActionForm,ClientLoginForm} from "@/components/form"
import {Card} from "@/components/ui/card"

type Company={client_name?:string;id:string;name:string;plan_id:string;status:string;expires_on:string|null;user_limit:number|null}
type Plan={id:string;name:string;user_limit:number}
function CompanyForm({plans,company}:{plans:Plan[];company?:Company}) {
  return <ActionForm operation="master" label={company?"Salvar empresa":"Criar empresa"}>
    <input name="id" type="hidden" value={company?.id ?? ""}/><label>Nome da empresa<input name="name" required minLength={2} defaultValue={company?.name}/></label>
    <label>Nome do cliente<input name="client" required maxLength={120} defaultValue={company?.client_name}/></label>
    {!company && <label>E-mail do proprietário<input type="email" name="email" required/></label>}
    {!company && <label>Atividade da empresa<select name="kind"><option value="retail">Venda de produtos</option><option value="services">Serviços e estoque de insumos</option></select></label>}
    <label>Logo da empresa (até 700 KB)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp"/></label>
    <label>Plano<select name="plan" defaultValue={company?.plan_id}>{plans.map(p=><option value={p.id} key={p.id}>{p.name} ({p.user_limit} usuários)</option>)}</select></label>
    <label>Status<select name="status" defaultValue={company?.status ?? "active"}><option value="active">Ativa</option><option value="suspended">Suspensa</option></select></label>
    <label>Vencimento<input name="expiry" type="date" defaultValue={company?.expires_on ?? ""}/></label>
    <label>Limite personalizado<input name="seats" type="number" min="1" defaultValue={company?.user_limit ?? ""}/></label>
  </ActionForm>
}
export const dynamic="force-dynamic"
export default async function Master({searchParams}:{searchParams:Promise<{q?:string;status?:string;edit?:string}>}) {
  const query=await searchParams
  const db=configured?await database():null
  const response=db?await db.rpc("master_list"):null
  const data=response?.error && ["42501","PGRST301","PGRST303"].includes(response.error.code)?null:response
  const {pending,registered,authorized,recent,stores,plans}=(data?.data ?? {stores:[],plans:[]}) as {pending:string[];registered:number;authorized:number;recent:number;stores:Company[];plans:Plan[]}
  const edited=stores.find(company=>company.id===query.edit)
  const audit=edited && db?await db.rpc("company_audit",{s:edited.id}):null
  const entries=(audit?.data ?? []) as {id:number;created_at:string;action:string;email:string}[]
  const eventNames:Record<string,string>={store_created:"Criação da loja",product_saved:"Cadastro ou edição de produto",member_saved:"Alteração de funcionário",store_saved:"Configuração da loja",subscription_saved:"Alteração da empresa ou assinatura"}
  return <main className="master-page"><Link href="/" className="auth-back"><ArrowLeft size={16}/> Gestão da loja</Link>
    <Heading title="Painel do gestor" subtitle="Administração de empresas e assinaturas da plataforma."><span className="metric-icon blue"><ShieldCheck size={20}/></span>{data && <form action={logout}><button className="button outline">Sair</button></form>}</Heading>
    {!data?<Card className="gate"><h2>Acesso restrito</h2><p>Esta área exige uma conta de administrador da plataforma.</p><Link className="button default" href="/gestor">Entrar</Link></Card>:
    data.error?<p className="error" role="alert">{data.error.message}</p>:<>
      <div className="summary-grid">{[["Contas cadastradas",registered],["Pessoas autorizadas",authorized],["Acessaram loja em 24 h",recent],["Empresas cadastradas",stores.length],["Empresas ativas",stores.filter(s=>s.status==="active").length],["Empresas suspensas",stores.filter(s=>s.status==="suspended").length]].map(([label,count])=><Card className="metric" key={label}><span className="metric-icon blue"><Building2 size={18}/></span><h3>{label}</h3><strong>{count}</strong></Card>)}</div>
      <Card className="panel"><h2>Autorizar acesso por e-mail</h2>{!!pending?.length && <details><summary>Ver solicitações pendentes</summary><ul>{pending.map(email=><li key={email}>{email}</li>)}</ul></details>}<ActionForm operation="access"><label>E-mail confirmado<input name="email" type="email" list="pending-accounts" required/><datalist id="pending-accounts">{pending?.map(email=><option key={email} value={email}/>)}</datalist></label><label>Decisão<select name="decision"><option value="approve">Autorizar</option><option value="block">Bloquear acesso às lojas</option></select></label></ActionForm></Card>
      <Card className="panel"><h2>Segurança da conta</h2><ClientLoginForm/><details><summary>Excluir conta definitivamente</summary><p>Apaga a conta e as empresas em que ela é a única proprietária. O e-mail volta a ficar disponível para cadastro.</p><ActionForm operation="deleteAccount" label="Excluir conta e dados" danger><label>E-mail da conta<input type="email" name="email" required/></label><label>Digite o mesmo e-mail para confirmar<input type="email" name="confirmation" required/></label></ActionForm></details></Card>
      <Card className="panel"><h2>Nova empresa</h2><CompanyForm plans={plans}/></Card>
      <Card className="panel"><h2>Empresas</h2><form className="filters"><input aria-label="Buscar empresa ou cliente" name="q" placeholder="Empresa ou nome do cliente" defaultValue={query.q}/><select name="status" aria-label="Filtrar situação" defaultValue={query.status}><option value="">Todas as situações</option><option value="active">Ativas</option><option value="suspended">Suspensas</option><option value="due">Vencimento em até 7 dias</option></select><button className="button outline">Buscar</button></form>{!stores.length && <p className="empty">Nenhuma empresa cadastrada.</p>}<div className="item-list">{stores.filter(c=>(c.name+" "+(c.client_name||"")).toLowerCase().includes((query.q||"").toLowerCase()) && (!query.status || c.status===query.status || (query.status==="due" && c.expires_on && c.expires_on>=new Date().toISOString().slice(0,10) && c.expires_on<=new Date(Date.now()+7*86400000).toISOString().slice(0,10)))).map(company=><div className="item-detail" key={company.id}><div className="company-row"><b>{company.name}<small>{company.client_name}</small></b><span>{plans.find(p=>p.id===company.plan_id)?.name}</span><span className={"badge "+(company.status==="active"?"green":"red")}>{company.status==="active"?"Ativa":"Suspensa"}</span><span>{company.expires_on ?? "Sem vencimento"}</span><Link className="button outline" href={{query:{...query,edit:query.edit===company.id?undefined:company.id}}}>{query.edit===company.id?"Fechar":"Editar"}</Link></div>{query.edit===company.id && <div className="detail-body"><CompanyForm plans={plans} company={company}/><details><summary>Remover acesso desta empresa</summary><ActionForm operation="removeMember" store={company.id} label="Remover acesso" danger><label>E-mail da pessoa<input type="email" name="email" required/></label></ActionForm></details><details><summary>Excluir empresa</summary><ActionForm operation="removeCompany" store={company.id} label="Excluir definitivamente" danger><label>Esta ação apaga estoque, vendas e serviços. Digite o nome exato da empresa para confirmar.<input name="confirmation" required/></label></ActionForm></details><h3>Últimas alterações administrativas</h3>{audit?.error?<p role="alert">Falha ao consultar o histórico.</p>:entries.length?<ul>{entries.map(event=><li key={event.id}>{eventNames[event.action] ?? event.action} · {event.email} · {new Date(event.created_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})} (Brasília)</li>)}</ul>:<p>Nenhuma alteração registrada.</p>}</div>}</div>)}</div></Card>
    </>}
  </main>
}
