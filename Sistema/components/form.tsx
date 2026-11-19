"use client"
import {startTransition,useActionState} from "react"
import {authenticate,mutate,manageLogin,type ActionState} from "@/app/actions"
import {Button} from "@/components/ui/button"

export function ActionForm({children,operation,store,label="Salvar",danger=false}:{
  children:React.ReactNode;operation:string;store?:string;label?:string;danger?:boolean
}) {
  const [state,action,pending]=useActionState(mutate,{})
  return <form action={action} className="form-grid" onSubmit={event=>{
    event.preventDefault()
    const form=new FormData(event.currentTarget)
    startTransition(()=>action(form))
  }}>
    <input type="hidden" name="operation" value={operation}/><input type="hidden" name="store" value={store ?? ""}/>
    {children}
    <div className="form-actions"><Button disabled={pending} variant={danger?"danger":"default"}>{pending?"Processando…":label}</Button><Feedback state={state}/></div>
  </form>
}
export function Feedback({state}:{state:ActionState}) {
  return <>{state.error && <p role="alert" className="error">{state.error}</p>}{state.message && <p role="status" className="success">{state.message}</p>}</>
}
export function AuthForm({manager=false}:{manager?:boolean}) {
  const [state,action,pending]=useActionState(authenticate,{})
  return <form action={action} className="auth-form">
    <input type="hidden" name="portal" value={manager?"manager":"store"}/><label>E-mail<input name="email" type="email" autoComplete="username" placeholder="voce@exemplo.com" required/></label>
    <label>Senha<input name="password" type="password" autoComplete="current-password" placeholder="••••••••" required/></label>
    <Feedback state={state}/>
    <Button name="intent" value="login" disabled={pending}>Entrar</Button>
  </form>
}

export function ClientLoginForm(){
 const [state,action,pending]=useActionState(manageLogin,{})
 return <form action={action} className="auth-form"><label>Operação<select name="mode"><option value="create">Criar acesso de cliente</option><option value="reset">Redefinir senha de cliente</option></select></label><label>E-mail do cliente<input type="email" name="email" required/></label><label>Nova senha (mínimo 12 caracteres)<input type="password" name="password" minLength={12} autoComplete="new-password" required/></label><Button disabled={pending}>Confirmar</Button><Feedback state={state}/></form>
}
