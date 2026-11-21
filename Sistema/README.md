EXECUTIVO EMPRESARIAL — ACESSOS, VENDAS E LUCRO

PARA ATUALIZAR A LOJA EXISTENTE
1. No projeto Supabase que a loja usa, confirme que a conta de gestor existe em Authentication → Users. Se perdeu acesso, o administrador do projeto pode definir uma nova senha para a conta nas ferramentas administrativas do Supabase Auth. Nunca compartilhe a senha ou chave secreta pelo chat. A senha do painel é a da conta em Authentication, independente das senhas de banco, Vercel ou GitHub.
2. No SQL Editor, execute Atualizar-Executivo-Empresarial.sql (arquivo da raiz). Ele pressupõe que a base inicial está instalada e que o e-mail do gestor já foi confirmado.
3. Na Vercel, nas variáveis de ambiente do projeto em Produção, mantenha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY e adicione SUPABASE_SECRET_KEY. Copie a Secret Key das API Keys do MESMO projeto Supabase. Use essa chave somente no servidor da Vercel. Nunca coloque a chave no GitHub ou em variável NEXT_PUBLIC.
4. Publique o conteúdo de Sistema no mesmo GitHub e aguarde a implantação na Vercel.
5. No Supabase → Authentication, desative Allow new users to sign up. Em Auth Hooks, habilite o Send Email Hook do tipo Postgres e selecione public.administered_auth_email. Esse hook bloqueia o envio de todos os e-mails de autenticação desse projeto, inclusive recuperação solicitada diretamente na API. A configuração é para o projeto dedicado a este SaaS. Confira o resultado tentando solicitar uma recuperação.
6. Abra o domínio principal da sua loja seguido de /gestor. Em Segurança da conta, crie o acesso com e-mail e senha. Em Nova empresa use o mesmo e-mail do proprietário. Para um funcionário, vincule o e-mail em Funcionários na loja. Para redefinir escolha Redefinir senha de cliente, informe o e-mail e a nova senha. Entregue a senha diretamente ao titular. A conta do gestor é protegida desse fluxo.
7. No PDV, ajuste a data quando necessário e informe o comprador se desejar. Em Relatórios → Produtos vendidos, o lucro bruto desconta os descontos proporcionais e o custo histórico. A lista considera só vendas concluídas e usa a data da venda. O histórico mantém também a data/hora do lançamento.
8. Abra uma loja com produtos no mínimo ou esgotados. Abra o sininho no topo para ver os avisos de estoque baixo e esgotado.

INSTALAÇÃO NOVA
Crie o projeto Supabase dedicado. Execute os sete arquivos de Sistema/supabase/migrations em ordem de nome, uma consulta por arquivo no SQL Editor. Em Authentication → Users → Add user → Create new user, crie executivoempresarialpj@gmail.com com sua senha e confirme a conta (Auto Confirm User). Execute Sistema/supabase/admin/ativar-gestor.sql. Siga os passos 3 a 8 acima. Configure Site URL com o domínio de produção. A base fica no Supabase; o pacote contém os arquivos do programa.


INSTALAÇÃO DO ZERO PELO NAVEGADOR
1. Extraia o ZIP. Crie um projeto vazio no Supabase. Em SQL Editor → New query, execute INSTALAR-BANCO-NOVO.sql apenas nesse projeto vazio. Esse arquivo já contém as sete migrations em ordem. Escolha esse caminho ou execute as migrations separadas uma vez.
2. Em Authentication → Users → Add user → Create new user, cadastre executivoempresarialpj@gmail.com com sua senha e Auto Confirm User. Execute Sistema/supabase/admin/ativar-gestor.sql no SQL Editor.
3. Abra um repositório privado no GitHub. Clique em Add file → Upload files e arraste o conteúdo de Sistema preservando as pastas. Confirme que app e package.json aparecem juntos na raiz e clique em Commit changes.
4. Na Vercel → Novo projeto, importe o repositório. Selecione Next.js e diretório raiz ./. Nas variáveis de ambiente da produção, preencha NEXT_PUBLIC_SUPABASE_URL com a URL do projeto, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY com a chave pública e SUPABASE_SECRET_KEY com a chave secreta do mesmo projeto Supabase. Clique em Implantar.
5. Use o domínio principal de produção e configure Site URL e o bloqueio de cadastro e recuperação descritos acima. Abra /gestor para criar o acesso e depois a empresa.

EMPRESAS E SERVIÇOS
Em Nova empresa escolha Venda de produtos ou Serviços e estoque de insumos e informe o e-mail do acesso criado. No modo de serviços, registre cada atendimento pelo valor combinado. Use Estoque para entradas e retiradas de insumos consumidos. No Painel Executivo, veja receita, custos diretos informados, resultado bruto e estoque a custo. Use Serviços para registrar pagamento, buscar atendimentos e exportar o histórico exibido. Funcionários com acesso operacional veem seus lançamentos.
Em Empresas → Editar, escolha uma imagem PNG, JPEG ou WebP de até 700 KB e salve. Remover acesso desta empresa desativa o vínculo indicado. Excluir empresa exige digitar o nome exato e apaga permanentemente seus dados comerciais. Faça backup antes de excluir ou reinstalar.
Em Segurança da conta → Excluir conta definitivamente, digite duas vezes o mesmo e-mail. A exclusão libera o e-mail e apaga as empresas em que a conta é a única proprietária. Contas gestoras e contas com histórico ou propriedade compartilhada em outra empresa são protegidas. Para estas, use a remoção de acesso por empresa.
Em Relatórios → Produtos vendidos, filtre por período e produto e ordene por quantidade, venda bruta, custo ou lucro.
No iPhone, entre na loja correta pelo Safari, abra Compartilhar → Adicionar à Tela de Início e confirme Adicionar. Se aparecer Abrir como App da Web, ative. Depois de alterar a logo, adicione o atalho novamente para renovar a imagem. A operação requer internet.

### Notificações de venda e baixa de gelo

Aplique a migração `202611210001_sales_updates.sql` antes de publicar. Na Adega do Chefinho, o cadastro deve conter um único produto ativo chamado **Gelo** (ou **Gelos**). Valide os nomes de Baldão de Whisky (também aceita Hisky, Whiskey e Uísque) e Copão no catálogo da loja.

Para ativar o push, gere uma única chave com `npx web-push generate-vapid-keys` e configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (contato no formato `mailto:`) e `SUPABASE_SERVICE_ROLE_KEY` no ambiente de servidor da Vercel. Cada pessoa autoriza seu aparelho no sino de avisos da loja. Titulares e gestores com acesso a vendas recebem as vendas da loja. Operadores recebem as vendas que registraram.
