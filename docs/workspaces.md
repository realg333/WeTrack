# Workspaces

Use **Novo workspace** no menu lateral ou **Criar workspace** no seletor de operação. O workspace criado é selecionado automaticamente e abre a visão geral com métricas zeradas.

Cada workspace tem campanhas, investimento, vendas, visitas, atribuição, WhatsApp, regras, taxas e preferências próprios. A seleção fica salva neste navegador. Ao trocar, a interface descarta os dados e detalhes da operação anterior, inclusive respostas de atualização que chegarem atrasadas.

Em **Configurações → Gerenciar workspaces**, é possível buscar, abrir e renomear operações. O nome também aparece no seletor e no topo da página. Nomes têm de 2 a 80 caracteres e não podem se repetir, independentemente de maiúsculas e minúsculas. A demonstração não pode ser renomeada.

## Integrações

Na criação, **Reutilizar autorização Meta** disponibiliza as contas do perfil já conectado, com todas desativadas no novo workspace. Essa opção copia somente a autorização criptografada: não importa campanhas, investimento, histórico ou seleção de contas. Não há sincronização automática das autorizações entre workspaces depois da criação.

Em **Integrações → Meta Ads**, ative somente as contas da operação e sincronize o período desejado. Conectar outro perfil ou desativar uma conta afeta apenas o workspace selecionado. Sincronizar uma conta importa o histórico do período solicitado; por isso, selecione contas e datas que pertencem à operação.

Pixels, links e webhooks são próprios de cada workspace. Crie e instale o pixel da nova operação e configure a URL de webhook correspondente no checkout. Pausar um pixel interrompe novos eventos, mantendo seu histórico. As integrações e os dados dos outros workspaces são preservados.

## API

- `GET /api/projects`: lista workspaces.
- `POST /api/projects`: recebe `name` e, opcionalmente, `reuse_meta_from`; retorna o novo workspace com status 201.
- `PATCH /api/projects/:id`: recebe `name`, preservando o identificador e o histórico.
- `GET /api/settings?project=:id` e `PUT /api/settings` com `project_id`: preferências da operação.

Todas essas rotas exigem sessão administrativa em produção. Preferências antigas continuam disponíveis no workspace original; novas operações começam com preferências independentes. A criação e a renomeação são transacionais no SQLite e no driver libSQL de produção.
