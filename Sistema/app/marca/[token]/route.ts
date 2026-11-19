import {configured,database} from "@/lib/supabase"
export async function GET(_:Request,{params}:{params:Promise<{token:string}>}){
 const {token}=await params
 if(!configured || !/^[a-f0-9-]{36}$/i.test(token))return new Response(null,{status:404})
 const {data}=await (await database()).rpc("brand_asset",{token})
 if(!data?.picture)return new Response(null,{status:404})
 let bytes=Buffer.from(data.picture,"base64")
 if(!data.native){try{bytes=await (await import("sharp")).default(bytes).trim({background:"#ffffff",threshold:5}).png().toBuffer()}catch{}}
 return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"image/png","Cache-Control":"public,max-age=86400","X-Content-Type-Options":"nosniff"}})
}
