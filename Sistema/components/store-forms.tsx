import {ActionForm} from "@/components/form"
import type {Product,Member} from "@/lib/models"
export const capabilities={products:"Gerenciar produtos e preços",stock:"Movimentar estoque",sales:"Consultar todas as vendas",executive:"Acessar Painel Executivo",reports:"Acessar Relatórios e exportar dados",cancel:"Cancelar vendas"}
export function ProductForm({services,store,product,minimum=0,unit="un"}:{services?:boolean;store:string;product?:Product;minimum?:number;unit?:string}) {
  return <ActionForm operation="product" store={store} label={product?"Salvar produto":"Cadastrar produto"}>
    <input type="hidden" name="id" value={product?.id ?? ""}/>
    <label>Nome<input name="name" required defaultValue={product?.name}/></label>
    <label>SKU<input name="sku" required defaultValue={product?.sku}/></label>
    <label>Código de barras<input name="barcode" defaultValue={product?.barcode ?? ""}/></label>
    <label>Categoria<input name="category" defaultValue={product?.category ?? ""}/></label>
    <label>Imagem (URL)<input name="image_url" type="url" pattern="https?://.+" defaultValue={product?.image_url ?? ""}/></label>
    <label>Custo (R$)<input name="cost" type="number" min="0" step=".01" required defaultValue={product?.cost}/></label>
    {services?<input type="hidden" name="price" value="0"/>:<label>Preço de venda (R$)<input name="price" type="number" min="0" step=".01" required defaultValue={product?.price}/></label>}
    {!product && <label>Estoque inicial<input name="stock" type="number" min="0" step=".001" required defaultValue="0"/></label>}
    <label>Estoque mínimo<input name="minimum" type="number" min="0" step=".001" required defaultValue={product?.minimum ?? minimum}/></label>
    <label>Unidade de medida<input name="unit" required defaultValue={product?.unit ?? unit}/></label>
    <label className="check"><input name="active" type="checkbox" defaultChecked={product?.active ?? true}/> Produto ativo</label>
  </ActionForm>
}
export function MemberForm({store,member}:{store:string;member?:Member}) {
  return <ActionForm operation="member" store={store} label="Salvar funcionário">
    <label>Nome<input name="name" required defaultValue={member?.name}/></label>
    <label>E-mail da conta<input name="email" type="email" required defaultValue={member?.email} readOnly={!!member}/></label>
    <label>Perfil<select name="role" defaultValue={member?.role ?? "cashier"}><option value="cashier">Operador de caixa</option><option value="manager">Gerente</option></select></label>
    <label className="check"><input name="active" type="checkbox" defaultChecked={member?.active ?? true}/> Acesso ativo</label>
    <fieldset><legend>Permissões do gerente</legend>{Object.entries(capabilities).map(([key,label])=><label className="check" key={key}><input type="checkbox" name="capabilities" value={key} defaultChecked={member?.permissions.includes(key)}/>{label}</label>)}</fieldset>
  </ActionForm>
}
