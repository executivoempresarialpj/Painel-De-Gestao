"use client"
import Link from "next/link"
import { useRef, useState } from "react"
import { Download, Upload } from "lucide-react"
import { importProductSheet } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { IMPORT_MODEL, MAX_IMPORT_BYTES, parseProductImport } from "@/lib/product-import"
import { brl, num } from "@/lib/utils"

function downloadModel() {
  const url=URL.createObjectURL(new Blob(["\uFEFF",IMPORT_MODEL],{type:"text/csv;charset=utf-8"}))
  const link=document.createElement("a")
  link.href=url
  link.download="modelo-produtos-executivo.csv"
  link.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}

export function ProductImport({store}:{store:string}) {
  const [source,setSource]=useState("")
  const [preview,setPreview]=useState<ReturnType<typeof parseProductImport>|null>(null)
  const [reading,setReading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState("")
  const [result,setResult]=useState<{count:number;alreadyImported:boolean}|null>(null)
  const submitting=useRef(false)

  async function previewFile(file?:File) {
    setSource("")
    setPreview(null)
    setResult(null)
    setError("")
    if (!file) return
    if (!/\.csv$/i.test(file.name) || file.size>MAX_IMPORT_BYTES) {
      setError("Selecione um arquivo CSV de até 256 KB.")
      return
    }
    setReading(true)
    try {
      const text=await file.text()
      setSource(text)
      setPreview(parseProductImport(text))
    } catch {
      setError("Não foi possível abrir esse arquivo.")
    } finally {
      setReading(false)
    }
  }

  async function save() {
    if (submitting.current || !source || !preview?.rows.length || preview.errors.length || result) return
    submitting.current=true
    setSaving(true)
    setError("")
    try {
      const response=await importProductSheet(store,source)
      if (response.result) setResult(response.result)
      else setError(response.error ?? "Não foi possível confirmar a importação.")
    } catch {
      setError("A conexão foi interrompida. Tente importar o mesmo arquivo novamente para conferir o resultado.")
    } finally {
      submitting.current=false
      setSaving(false)
    }
  }

  return <Card className="panel">
    <div className="panel-heading"><h2>Importar produtos</h2><Link href="/produtos" className="text-link">Fechar</Link></div>
    <p className="muted">Preencha nome, custo, preço e estoque. Se deixar o SKU vazio, o sistema cria um código. Salve no Excel como CSV UTF-8.</p>
    <div className="filters">
      <Button type="button" variant="outline" onClick={downloadModel}><Download size={16}/> Baixar modelo</Button>
      <label>Planilha CSV (até 250 produtos)<input type="file" accept=".csv,text/csv" disabled={reading||saving} onChange={event=>void previewFile(event.currentTarget.files?.[0])}/></label>
    </div>
    {reading && <p role="status">Lendo a planilha…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {!!preview?.errors.length && <ul className="error" role="alert">{preview.errors.slice(0,10).map(message=><li key={message}>{message}</li>)}{preview.errors.length>10 && <li>Mais {preview.errors.length-10} linhas precisam de revisão.</li>}</ul>}
    {!!preview?.rows.length && <>
      <p className="muted">Prévia dos primeiros {Math.min(preview.rows.length,10)} de {preview.rows.length} produtos válidos.</p>
      <div className="table-wrap"><table><thead><tr><th>Produto</th><th>SKU</th><th>Custo</th><th>Preço de venda</th><th>Estoque inicial</th></tr></thead><tbody>
        {preview.rows.slice(0,10).map(row=><tr key={row.line}><td>{row.name}</td><td>{row.sku||"Automático"}</td><td>{brl(Number(row.cost))}</td><td>{brl(Number(row.price))}</td><td>{num(Number(row.stock))}</td></tr>)}
      </tbody></table></div>
      <div className="filters"><Button type="button" disabled={reading||saving||!!result||!!preview.errors.length} onClick={save}><Upload size={16}/>{saving?"Importando…":"Importar produtos"}</Button></div>
    </>}
    {result && <p className="success" role="status">{result.alreadyImported?"Essa planilha já foi importada nesta loja.":result.count===1?"1 produto cadastrado.":`${result.count} produtos cadastrados.`}</p>}
  </Card>
}
