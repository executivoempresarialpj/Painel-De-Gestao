export const MAX_IMPORT_BYTES = 256 * 1024
export const MAX_IMPORT_PRODUCTS = 250
export const IMPORT_MODEL = "nome;custo;preço;estoque;sku;categoria;código de barras\r\n"
const required = ["nome", "custo", "preco", "estoque"]

type ImportedProduct = {
  line: number; name: string; cost: string; price: string; stock: string
  sku: string; category: string; barcode: string
}

function readCsv(source: string) {
  const content = source.replace(/^\uFEFF/, "")
  const delimiter = content.split(/\r?\n/, 1)[0].includes(";") ? ";" : ","
  const rows: {line:number; cells:string[]}[] = []
  let cells: string[] = []
  let field = "", line = 1, rowLine = 1
  let quoted = false, closed = false
  const finishField = () => { cells.push(field.trim()); field = ""; closed = false }
  const finishRow = () => {
    finishField()
    if (cells.some(Boolean)) rows.push({line:rowLine,cells})
    cells = []
  }
  for (let index=0; index<content.length; index++) {
    const char = content[index]
    if (quoted) {
      if (char === '"' && content[index+1] === '"') { field += '"'; index++ }
      else if (char === '"') { quoted = false; closed = true }
      else { field += char; if (char === "\n") line++ }
    } else if (char === delimiter) finishField()
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && content[index+1] === "\n") index++
      finishRow()
      rowLine = ++line
    } else if (char === '"' && !closed && !field.trim()) {
      field = ""; quoted = true
    } else if (closed && /[ \t]/.test(char)) {
      continue
    } else if (closed || char === '"') {
      throw new Error(`Linha ${line}. Confira as aspas da planilha.`)
    } else field += char
  }
  if (quoted) throw new Error(`Linha ${rowLine}. Há uma célula com aspas abertas.`)
  finishRow()
  return rows
}

function decimal(value:string, places:number) {
  const clean = value.replace(/^R\$\s*/, "").trim()
  if (!/^(?:\d{1,12}|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(clean)
      && !/^\d{1,12}\.\d+$/.test(clean)) return null
  const normalized = clean.includes(",") ? clean.replaceAll(".", "").replace(",", ".") : clean
  const [integer, fraction=""] = normalized.split(".")
  if (integer.length > 14 - places || fraction.length > places) return null
  return normalized
}

export function parseProductImport(source:string): {rows:ImportedProduct[];errors:string[]} {
  try {
    if (new TextEncoder().encode(source).byteLength > MAX_IMPORT_BYTES) throw new Error("O arquivo deve ter até 256 KB.")
    const [first,...records] = readCsv(source)
    if (!first || !records.length) throw new Error("A planilha precisa ter pelo menos um produto abaixo do cabeçalho.")
    if (records.length > MAX_IMPORT_PRODUCTS) throw new Error("Importe até 250 produtos por arquivo.")
    const header = first.cells.map(cell => cell.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"").replace(/\s+/g," "))
    if (required.some(name=>!header.includes(name)) || new Set(header).size !== header.length) {
      throw new Error("Use o cabeçalho do modelo com nome, custo, preço e estoque.")
    }
    const rows:ImportedProduct[] = []
    const errors:string[] = []
    const skus = new Set<string>()
    const barcodes = new Set<string>()
    for (const {line,cells} of records) {
      const get = (column:string) => cells[header.indexOf(column)] ?? ""
      const name = get("nome"), sku = get("sku"), category = get("categoria"), barcode = get("codigo de barras")
      const cost = decimal(get("custo"),2), price = decimal(get("preco"),2), stock = decimal(get("estoque"),3)
      let issue = ""
      if (cells.length > header.length) issue = "Há mais colunas que no cabeçalho."
      else if (!name || name.length>120) issue = "Informe um nome de até 120 caracteres."
      else if (cost===null || price===null || stock===null) issue = "Confira custo, preço e estoque. Use números maiores ou iguais a zero, como 19,90."
      else if (sku.length>64 || barcode.length>64 || category.length>120) issue = "O SKU e o código de barras devem ter até 64 caracteres e a categoria até 120."
      else if (sku && skus.has(sku)) issue = "SKU repetido na planilha."
      else if (barcode && barcodes.has(barcode)) issue = "Código de barras repetido na planilha."
      if (issue || cost===null || price===null || stock===null) { errors.push(`Linha ${line}. ${issue}`); continue }
      if (sku) skus.add(sku)
      if (barcode) barcodes.add(barcode)
      rows.push({line,name,cost,price,stock,sku,category,barcode})
    }
    return {rows,errors}
  } catch(error) {
    return {rows:[],errors:[error instanceof Error?error.message:"Não foi possível ler a planilha."]}
  }
}

export function parseReceipt(source:string) {
  if(new TextEncoder().encode(source).byteLength>MAX_IMPORT_BYTES) throw new Error("Envie até 256 KB.")
  const [header,...records]=readCsv(source)
  if(header?.cells.map(x=>x.toLowerCase()).join(";")!=="sku;quantidade") throw new Error("Use as colunas SKU e quantidade, nessa ordem.")
  if(!records.length || records.length>250) throw new Error("Envie de 1 a 250 produtos.")
  const seen=new Set<string>()
  return records.map(({cells,line})=>{
    const [sku,raw]=cells
    const quantity=decimal(raw??"",3)
    if(cells.length!==2 || !sku || seen.has(sku) || !quantity || Number(quantity)<=0) throw new Error(`Linha ${line}. Confira o SKU, a quantidade positiva e entradas repetidas.`)
    seen.add(sku)
    return {sku,quantity}
  })
}
