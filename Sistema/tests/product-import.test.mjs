import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {test} from "node:test"
import ts from "typescript"

const source=await readFile(new URL("../lib/product-import.ts",import.meta.url),"utf8")
const module=ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})
const {parseProductImport,IMPORT_MODEL}=await import("data:text/javascript;base64,"+Buffer.from(module).toString("base64"))

test("aceita arquivo do Excel com separador brasileiro, BOM e moeda",()=>{
  const parsed=parseProductImport('\uFEFF'+IMPORT_MODEL+'"Perfume; clássico";R$ 1.200,00;1599,90;7;P1;Perfumaria;000432\r\n')
  assert.deepEqual(parsed,{errors:[],rows:[{line:2,name:"Perfume; clássico",cost:"1200.00",price:"1599.90",stock:"7",sku:"P1",category:"Perfumaria",barcode:"000432"}]})
})

test("aceita separador de vírgula e sinaliza números inválidos e códigos repetidos",()=>{
  const result=parseProductImport('nome,custo,preço,estoque,sku\n"Sabonete, suave",2.50,5,8,SB1\nOutro,2.50,5,8,SB1\nCopo,2.00,4,-1,C1')
  assert.equal(result.rows.length,1)
  assert.match(result.errors[0],/Linha 3.*SKU/)
  assert.match(result.errors[1],/Linha 4.*estoque/)
})
