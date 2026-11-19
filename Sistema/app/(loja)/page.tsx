import {redirect} from "next/navigation"
import {configured,can,session} from "@/lib/supabase"
import {dateRange,type Query,type Report} from "@/lib/report"
import {ServiceDashboard} from "@/components/services"
import {Dashboard} from "@/components/report-view"
export default async function Page({searchParams}:{searchParams:Promise<Query>}) {
  const auth=await session()
  const store=auth?.store
  if(store?.mode==="services")return can(store,"executive")?<ServiceDashboard store={store} query={await searchParams}/>:redirect("/servicos")
  if(store && !can(store,"executive")) redirect("/pdv")
  const range=dateRange(await searchParams,store?.timezone ?? "America/Sao_Paulo")
  const result=store && await auth.db.rpc("executive_report",{s:store.id,from_day:range.from,to_day:range.to})
  return <>{result && result.error && <p className="error" role="alert">{result.error.message}</p>}
    <Dashboard showReports={!!store && can(store,"reports")} report={result && !result.error?result.data as Report:undefined} range={range} user={store?.displayName || auth?.user.email?.split("@")[0]} signedIn={!!auth} configured={configured}/>
  </>
}
