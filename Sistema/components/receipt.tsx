"use client"
import {useState} from "react"
import {parseReceipt,MAX_IMPORT_BYTES} from "@/lib/product-import"
import {ActionForm} from "@/components/form"
export function Receipt({store}:{store:string}){
 const [rows,setRows]=useState<ReturnType<typeof parseReceipt>>([])
 const [error,setError]=useState("")
 const [busy,setBusy]=useState(false)
 return <details className="card panel"><summary>Registrar entrada por planilha</summary><p className="muted">Informe o SKU cadastrado e a quantidade recebida. A entrada soma unidades ao saldo atual.</p>
 <a href="/modelo-entrada.csv" download className="text-link">Baixar modelo CSV</a>
 <label>Planilha de entrada<input type="file" accept=".csv" disabled={busy} onChange={async e=>{
 const file=e.target.files?.[0];setRows([]);setError("")
 if(!file)return
 setBusy(true)
 try{if(file.size>MAX_IMPORT_BYTES)throw new Error("Limite de 256 KB.");setRows(parseReceipt(await file.text()))}
 catch(err){setError(err instanceof Error?err.message:"Arquivo inválido.")}finally{setBusy(false)}
 }}/></label>
 {error && <p className="error" role="alert">{error}</p>}
 {!!rows.length && <><p>{rows.length} produtos · {rows.slice(0,5).map(r=>r.sku+" (+"+r.quantity+")").join(", ")}</p><ActionForm operation="receipt" store={store} label="Confirmar entrada"><input type="hidden" name="lines" value={JSON.stringify(rows)}/><label>Número da nota ou referência única<input name="reference" required maxLength={80}/></label></ActionForm></>}
 </details>
}
