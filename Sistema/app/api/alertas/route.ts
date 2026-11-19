import {configured,database} from "@/lib/supabase"
export async function GET(request:Request){
 if(!configured)return new Response(null,{status:503})
 const db=await database()
 const {data,error}=await db.rpc("stock_notifications",{s:new URL(request.url).searchParams.get("s"),review:false})
 return error?new Response(null,{status:403}):Response.json(data,{headers:{"Cache-Control":"private, no-store"}})
}
