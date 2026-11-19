import {session} from "@/lib/supabase"
export async function GET(){
 const store=(await session())?.store
 const name=store?.name || "Executivo Empresarial"
 return Response.json({name,short_name:name,start_url:"/",display:"standalone",theme_color:"#101f32",background_color:"#ffffff",icons:[{src:store?.logo?"/marca/"+store.logo+"?v=2":"/icone.png",sizes:store?.logo?"256x256":"180x180",type:"image/png"}]},{headers:{"Cache-Control":"private, no-store","Content-Type":"application/manifest+json"}})
}
