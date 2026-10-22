# Agendamento das regras

As regras precisam de uma execução periódica mesmo com o painel fechado. O navegador não é o agendador principal. Existem dois modos:

| Modo          | Quem agenda                       | Onde as regras executam                       | Depende da Vercel para executar? |
| ------------- | --------------------------------- | --------------------------------------------- | -------------------------------- |
| HTTP atual    | GitHub Actions ou outro cron HTTP | API de produção                               | Sim                              |
| Worker direto | Cron de um servidor próprio       | Node.js no servidor, ligado ao Turso e à Meta | Não                              |

O workflow `.github/workflows/campaign-rules.yml` está configurado para cinco minutos. O GitHub não garante esse intervalo: a consulta ao histórico em 22/10/2026 encontrou execuções com sucesso separadas por várias horas. Regras de pausa, corte e orçamento não devem depender de uma promessa de precisão desse serviço. [O GitHub documenta atrasos e descarte de disparos em períodos de carga, além da desativação após 60 dias sem atividade em repositórios públicos](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Na Vercel Hobby, [o cron nativo tem frequência mínima diária](https://vercel.com/docs/cron-jobs/usage-and-pricing). Um cron externo resolve a frequência sem exigir a troca de plano; um cron HTTP continua usando a função e os limites da Vercel. Para independência completa, execute o worker direto.

## Cron HTTP externo

Em um serviço de agendamento com acesso já configurado, crie uma chamada a cada cinco minutos:

- Método: `GET`.
- URL: `https://wetrack-psi.vercel.app/api/internal/rules-run`.
- Cabeçalho privado: `Authorization: Bearer <valor de RULES_CRON_SECRET da produção>`.
- Cabeçalho: `X-WeTrack-Scheduler: external`.
- Timeout: 240 segundos; conexão: 20 segundos.
- Considere qualquer resposta fora de 2xx como falha; habilite a notificação de falhas do provedor.

Teste primeiro a mesma URL com `?check_only=1`. O diagnóstico verifica autenticação e banco, mas não sincroniza a Meta, não executa regras e não registra um ciclo bem sucedido. Nunca coloque o segredo na URL, no Git ou em código do navegador. O segredo já usado no GitHub está em `data/rules-scheduler.json` no ambiente autorizado e é ignorado pelo Git.

O script `scripts/configure-rules-scheduler.mjs` configura os secrets existentes na Vercel e no GitHub. Ele não cria conta nem configura um terceiro provedor de cron. Não é necessário executá-lo novamente quando esses secrets já estão funcionando.

## Worker direto em VPS ou servidor existente

O worker executa um ciclo e encerra. Não abre servidor HTTP, não inicia timers e não usa o banco SQLite local. Ele conecta diretamente ao mesmo Turso da produção e usa as credenciais Meta já criptografadas nesse banco. As migrações continuam sendo responsabilidade do aplicativo publicado: o worker falha se o schema não existir.

Use Node.js 24 e uma cópia de `main` em um servidor com acesso de saída HTTPS à Meta e ao Turso. Depois de instalar as dependências com `npm ci --omit=dev`, mantenha um arquivo privado fora do checkout, por exemplo `/etc/wetrack/rules.env`, com estas quatro variáveis:

```dotenv
TURSO_DATABASE_URL=libsql://SEU_BANCO_DE_PRODUCAO
TURSO_AUTH_TOKEN=TOKEN_PRIVADO_DO_MESMO_BANCO
SECRETS_KEY=MESMOS_64_CARACTERES_HEXADECIMAIS_DA_PRODUCAO
META_GRAPH_VERSION=MESMA_VERSAO_CONFIGURADA_NA_PRODUCAO
```

As credenciais Turso também aceitam os nomes `DATABASE_TURSO_DATABASE_URL` e `DATABASE_TURSO_AUTH_TOKEN`. A chave precisa ser exatamente a mesma da produção para descriptografar as conexões. O worker não precisa de senha de administrador, segredo OAuth do app Meta nem `RULES_CRON_SECRET`. Restrinja a leitura do arquivo de ambiente ao usuário de serviço (`chmod 600`) e não copie todo o ambiente da Vercel desnecessariamente.

Valide o acesso sem executar ações:

```sh
cd /opt/wetrack
node --env-file=/etc/wetrack/rules.env scripts/run-rules-worker.mjs --check-only
```

O padrão sem argumentos também é diagnóstico. Somente `--run` executa as regras ativas. Para agendar, crie `data/` com acesso para o usuário de serviço, confirme os caminhos de `node` e `flock` com `command -v` e instale este crontab para esse usuário, adaptando `/opt/wetrack` e o caminho do Node:

```cron
*/5 * * * * cd /opt/wetrack && /usr/bin/flock -n data/rules-worker.lock /usr/bin/node --env-file=/etc/wetrack/rules.env scripts/run-rules-worker.mjs --run >> data/rules-worker.log 2>&1
```

Configure rotação do log e alerta de falha do processo no servidor. Saída diferente de zero indica falha. O `flock` evita sobreposição no servidor e a reserva gravada no Turso impede ações concorrentes entre o worker, o cron HTTP e o painel. Portanto, o GitHub pode permanecer como redundância. Evite iniciar `server/index.mjs` para esse propósito: ele também inicia a API local e outro timer.

Este repositório entrega o worker e o contrato de cron; uma VPS ou um terceiro serviço precisa ser configurado no ambiente em que houver acesso. A existência do script não significa que esse servidor externo já está implantado.

## Saúde e confirmação

`GET /api/rules?project=<operacao>` inclui `scheduler` com a origem, último início, conclusão, sucesso, erro e quantidade de regras ativas da operação. Um ciclo sem regras ativas confirma que o agendador está acessando a API, mas não altera campanhas.

- `never`: nenhum ciclo com heartbeat registrado nesta versão.
- `running`: um ciclo começou e ainda não concluiu.
- `healthy`: o último ciclo terminou sem falhas há até 15 minutos.
- `error`: o ciclo recente teve falhas; confira o histórico por operação.
- `stale`: o último início tem mais de 15 minutos; verifique o cron.

O diagnóstico e as verificações oportunistas durante o uso do painel não atualizam esse heartbeat. Assim, usar o painel não esconde um agendador parado. Uma requisição interrompida antes de concluir permanece identificável como ciclo em andamento e depois atrasado. Mesmo com cron de cinco minutos, custos e vendas têm atraso de atualização: regras não garantem teto instantâneo de gasto.
