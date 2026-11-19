"use server"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import {can,configured,database,session} from "@/lib/supabase"
import {parseProductImport} from "@/lib/product-import"

export type ActionState = {error?:string; message?:string}
const value = (form:FormData,key:string) => String(form.get(key) ?? "").trim()
const optional = (form:FormData,key:string) => value(form,key) || null
export async function authenticate(_:ActionState,form:FormData):Promise<ActionState> {
  if (!configured) return {error:"Configure as variáveis do Supabase para acessar sua conta."}
  const db=await database(true)
  const credentials={email:value(form,"email").toLowerCase(),password:String(form.get("password") ?? "")}
  try {
  {
    const {error}=await db.auth.signInWithPassword(credentials)
    if(error) {
      if(error.status===429)return {error:"Muitas tentativas. Aguarde um momento antes de entrar."}
      if(error.code==="email_not_confirmed")return {error:"Confirme seu e-mail antes de entrar."}
      if(error.code==="invalid_credentials")return {error:"E-mail ou senha incorretos."}
      return {error:"O serviço de autenticação não respondeu. Tente novamente em instantes."}
    }
    if(value(form,"portal")==="manager"){
      const check=await db.rpc("manager_access")
      if(check.error)return {error:"Falha ao consultar a permissão de gestor. Confira a atualização do banco e tente novamente."}
      if(!check.data)return {error:"A conta entrou, mas precisa de autorização como gestora."}
    }
  }
  } catch { return {error:"Falha ao iniciar a sessão. Confira a conexão e tente novamente."} }
  redirect(value(form,"portal")==="manager"?"/master":"/")
}
export async function logout() {
  if(configured) await (await database()).auth.signOut()
  ;(await cookies()).delete("varejo_store")
  redirect("/login")
}
export async function chooseStore(form:FormData) {
  const auth=await session()
  const id=value(form,"store")
  if(auth?.context.stores.some(store=>store.id===id && store.available)) {
    ;(await cookies()).set("varejo_store",id,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/"})
  }
  redirect("/")
}
export async function mutate(_:ActionState,form:FormData):Promise<ActionState> {
  const auth=await session()
  if(!auth) return {error:"Entre para continuar."}
  const s=auth.store?.id
  const operation=value(form,"operation")
  const selected=value(form,"store")
  if(!["access","master","removeCompany","removeMember","deleteAccount"].includes(operation) && (!s || s!==selected)) return {error:"A loja selecionada mudou. Recarregue a página."}
  let rpc:string
  let args:Record<string,unknown>
  switch(operation) {
    case "removeCompany":case "removeMember":
      if(!auth.context.master)return {error:"Acesso restrito."}
      rpc="manage_company_access";args={s:selected,address:value(form,"email"),confirmation:value(form,"confirmation"),remove_company:operation==="removeCompany"};break
    case "deleteAccount":
      if(!auth.context.master)return {error:"Acesso restrito."}
      rpc="delete_customer_account";args={address:value(form,"email"),confirmation:value(form,"confirmation")};break
    case "cancelJob":
      rpc="cancel_job";args={s,k:value(form,"id")};break
    case "job":
      rpc="record_job";args={s,expense:value(form,"cost")||"0",method:value(form,"method"),k:value(form,"key"),description:value(form,"description"),buyer:value(form,"buyer"),price:value(form,"amount"),d:value(form,"day")};break
    case "access":
      if(!auth.context.master) return {error:"Acesso restrito."}
      rpc="set_account_access"; args={account_email:value(form,"email"),allow_access:value(form,"decision")==="approve"}; break
    case "receipt": rpc="receive_sheet"; args={s,reference_code:value(form,"reference"),lines:JSON.parse(value(form,"lines"))}; break
    case "product":
      rpc="save_product"
      args={s,data:{id:value(form,"id"),name:value(form,"name"),sku:value(form,"sku"),barcode:value(form,"barcode"),category:value(form,"category"),image_url:value(form,"image_url"),cost:value(form,"cost"),price:value(form,"price"),minimum:value(form,"minimum"),unit:value(form,"unit"),active:form.has("active"),stock:value(form,"stock")||"0"}}
      break
    case "stock": rpc="adjust_stock"; args={s,p:value(form,"product"),amount:value(form,"amount"),operation:value(form,"kind"),reason:value(form,"reason")}; break
    case "cancel": rpc="cancel_sale"; args={s,sale:value(form,"sale"),why:value(form,"reason"),restore_stock:form.has("restore")}; break
    case "member": rpc="manage_member"; args={s,email_address:value(form,"email"),display_name:value(form,"name"),member_role:value(form,"role"),enabled:form.has("active"),capabilities:form.getAll("capabilities")}; break
    case "settings": rpc="save_preferences"; args={s,store_name:value(form,"name"),zone:value(form,"timezone"),minimum:value(form,"minimum"),unit:value(form,"unit")}; break
    case "master":
      if(!auth.context.master) return {error:"Acesso restrito."}
      let picture:string|null=null
      const logo=form.get("logo")
      if(logo instanceof File && logo.size){
        if(logo.size>700000 || !["image/png","image/jpeg","image/webp"].includes(logo.type))return {error:"Escolha PNG, JPEG ou WebP de até 700 KB."}
        try{
          const sharp=(await import("sharp")).default
          const img=sharp(Buffer.from(await logo.arrayBuffer()),{limitInputPixels:16000000})
          if(!["png","jpeg","webp"].includes((await img.metadata()).format || ""))return {error:"Imagem não aceita."}
          picture=(await img.rotate().resize(384,384,{fit:"inside",withoutEnlargement:true}).png({palette:true,quality:94}).toBuffer()).toString("base64")
        }catch{return {error:"Falha ao ler imagem."}}
      }
      rpc="configure_company"
      args={picture,kind:value(form,"kind")||"retail",s:optional(form,"id"),company:value(form,"name"),client:value(form,"client"),plan:value(form,"plan"),state:value(form,"status"),expiry:optional(form,"expiry"),seats:optional(form,"seats"),owner_email:optional(form,"email")}
      break
    default: return {error:"Operação desconhecida."}
  }
  const {data,error}=await auth.db.rpc(rpc,args)
  if(error) return {error:error.code==="23505"?"Já existe um registro com esse código.":error.message}
  revalidatePath("/", "layout")
  if(operation==="receipt") return {message:data===0?"Esta entrada já foi registrada.":data+" produtos atualizados."}
  return {message:"Operação concluída."}
}
export async function checkout(store:string, key:string, items:{id:string;quantity:string}[], rebate:string, payment:string,customer="",day?:string) {
  const auth=await session()
  if(!auth?.store || store!==auth.store.id) return {error:"A loja mudou ou a sessão expirou.",retry:true}
  const {data,error}=await auth.db.rpc("record_sale",{sold_on:day || null,customer,s:store,request_key:key,items,rebate,payment_method:payment})
  if(error) return {error:error.message, retry:!error.code || error.code==="PGRST000" || error.code==="PGRST001" || error.code==="PGRST002" || error.code==="PGRST003"}
  revalidatePath("/", "layout")
  return {sale:data as {id:string;number:number;total:number;status:string}}
}
export async function findProducts(store:string, query:string) {
  const auth=await session()
  if(!auth?.store || auth.store.id!==store) return {error:"A loja mudou ou a sessão expirou."}
  const {data,error}=await auth.db.rpc("product_catalog",{s:store,q:query.trim(),page_size:100,only_active:true})
  if(error) return {error:error.message}
  return {products:(data as import("@/lib/models").Product[]).filter(x=>x.active).map(({cost:_,...product})=>product)}
}

export async function importProductSheet(store:string, source:string) {
  const auth=await session()
  if (!auth?.store || store!==auth.store.id || !can(auth.store,"products")) {
    return {error:"Você não tem permissão para importar produtos nesta loja."}
  }
  if (typeof source!=="string") return {error:"Envie um arquivo CSV válido."}
  const {rows,errors}=parseProductImport(source)
  if (errors.length) return {error:errors[0]}
  const {data,error}=await auth.db.rpc("import_products",{s:store,products:rows})
  if (error) return {error:error.code==="PGRST202"?"A atualização de importação ainda precisa ser aplicada no Supabase.":error.message}
  revalidatePath("/", "layout")
  return {result:data as {count:number;alreadyImported:boolean}}
}

export async function readAlerts(store:string):Promise<{id:string;name:string;sku:string;stock:number}[]> {
 const db=await database()
 const {data,error}=await db.rpc("stock_notifications",{s:store,review:true})
 if(error)throw new Error("Falha na consulta de estoque.")
 return data.items
}


export async function manageLogin(_:ActionState,form:FormData):Promise<ActionState>{
 const db=await database()
 if((await db.rpc("manager_access")).data!==true)return {error:"Acesso restrito."}
 const email=value(form,"email").toLowerCase(),password=String(form.get("password") ?? "")
 if(!email || password.length<12)return {error:"Informe o e-mail e uma senha com pelo menos 12 caracteres."}
 const secret=process.env.SUPABASE_SECRET_KEY
 if(!secret)return {error:"Configure SUPABASE_SECRET_KEY no servidor da Vercel."}
 const {createClient}=await import("@supabase/supabase-js")
 const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,secret,{auth:{persistSession:false,autoRefreshToken:false}}).auth.admin
 if(value(form,"mode")==="reset"){
   const target=await db.rpc("reset_target",{address:email})
   if(target.error || !target.data)return {error:"Conta de cliente indisponível."}
   const result=await admin.updateUserById(target.data,{password})
   return result.error?{error:"Falha ao alterar a senha. Confira a configuração e a política de senha."}:{message:"Senha do cliente alterada."}
 }
 const result=await admin.createUser({email,password,email_confirm:true})
 if(result.error)return {error:"Falha ao criar conta. Verifique se o e-mail já existe e confira a política de senha."}
 const approval=await db.rpc("set_account_access",{account_email:email,allow_access:true})
 return approval.error?{error:"Conta criada. Autorize o e-mail no painel."}:{message:"Conta criada. Vincule o e-mail à empresa ou à equipe."}
}
