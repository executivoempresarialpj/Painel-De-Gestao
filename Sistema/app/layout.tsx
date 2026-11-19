import type {Metadata} from "next"
import "@fontsource-variable/inter"
import "./globals.css"
export const metadata:Metadata={title:"Executivo Empresarial • Gestão de loja",description:"Estoque, vendas e relatórios para lojas físicas."}
export default function Layout({children}:Readonly<{children:React.ReactNode}>) {
  return <html lang="pt-BR"><body>{children}</body></html>
}
