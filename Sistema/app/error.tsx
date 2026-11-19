"use client"
import {Button} from "@/components/ui/button"
export default function ErrorPage({reset}:{error:Error;reset:()=>void}) {
  return <main className="master-page"><section className="card gate"><h2>Não foi possível carregar a página</h2><p>Verifique a conexão e tente novamente.</p><Button onClick={reset}>Tentar novamente</Button></section></main>
}
