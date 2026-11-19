-- Execute uma vez no SQL Editor do projeto após confirmar o e-mail.
do $$
declare conta uuid;
begin
 select id into conta from auth.users where lower(email)='executivoempresarialpj@gmail.com' and email_confirmed_at is not null;
 if conta is null then raise exception 'Cadastre e confirme executivoempresarialpj@gmail.com antes de executar.'; end if;
 insert into public.platform_admins(user_id) values(conta) on conflict do nothing;
 insert into private.account_access(user_id,approved,changed_by) values(conta,true,conta)
 on conflict(user_id) do update set approved=true,changed_by=conta,changed_at=now();
end $$;
