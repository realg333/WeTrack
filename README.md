# WeTrack

Aplicação de rastreamento e análise de campanhas, com interface em português, identidade própria, SQLite local e publicação na Vercel com Turso persistente. Referências de produto: LowTrack e UTMify.

## Publicação na Vercel

Painel: **https://wetrack-wetrack.vercel.app**. Projeto `wetrack` na equipe `Wetrack`, conectado a `realg333/WeTrack` (branch `main`).

O ambiente publicado contém apenas **Descomplica Libras**. As sessões, visitas e vendas ficam no Turso Starter; arquivos temporários de Functions não são usados como banco. A senha gerada está no arquivo local privado `data/production-access.txt`, ignorado pelo Git e pelo envio à Vercel. A configuração inicial foi enviada criptografada em `WETRACK_BOOTSTRAP`; o marcador no banco impede reaplicar essa cópia sobre dados novos. O banco local e o banco publicado passam a ser independentes.

`api/index.mjs` atende `/api/*` e `/pixel.js`. O painel exige a senha própria da WeTrack; o domínio principal permite acesso ao pixel e aos webhooks. URLs individuais de deployments e previews continuam protegidas pela Vercel. As variáveis `ADMIN_PASSWORD`, `SECRETS_KEY`, `CRON_SECRET` e `WETRACK_BOOTSTRAP` existem somente em production. Previews precisam de banco e credenciais separados para usar a API.

Compras recebidas por webhook iniciam o envio CAPI com `waitUntil` depois da resposta HTTP. Há também uma verificação diária da fila às 06:00 UTC (03:00 de Brasília), compatível com o plano Hobby. Reenvios não executados por falta de tráfego aguardam a próxima verificação; não existe um processo contínuo a cada 30 segundos na Vercel.

A URL HTTPS está pronta. A autorização por link do Facebook ainda exige `META_APP_ID`, `META_APP_SECRET` e a configuração do aplicativo, com retorno `https://wetrack-wetrack.vercel.app/api/meta/oauth/callback`.

## Executar

Requer **Node.js 24 ou superior**. O SQLite usado pelo servidor é nativo do Node.

```powershell
npm ci
npm run dev
```

- Painel: <http://127.0.0.1:5173>
- API: <http://127.0.0.1:3001>
- Produção local: `npm run build` e `npm start`, com o painel servido pela API em `http://127.0.0.1:3001`.

O primeiro início cria **Operação principal**, com demonstração, e **Minha operação**, vazia para dados reais. Selecione a operação no topo da barra lateral. Dados de exemplo não entram nos resultados reais.

## Recursos

- Dashboard com faturamento aprovado, investimento, lucro sobre mídia, ROAS, CPA, ticket médio, visitantes, conversão e origens.
- Filtros, gráficos diários, busca, paginação, detalhes e exportação CSV.
- Campanhas locais, ativação local e registro de investimento diário. Orçamento não é contabilizado como gasto.
- Importação manual de campanhas, custos, cliques e impressões da Meta por token oficial, com paginação e atualização sem duplicação.
- Pixel com PageView, eventos manuais, autorização por domínio, identificador de visitante e preservação/propagação de UTMs por sete dias.
- API de vendas com tokens exclusivos, atualização de status, deduplicação e recuperação de atribuição pelo visitante.
- CAPI opcional: tokens criptografados, contato com SHA-256, fila persistente, ID estável e até cinco tentativas com espera progressiva.
- Histórico de envios CAPI, confirmação de recebimento pela Meta e reenvio de falhas.
- Alertas de indicadores no painel, notificações internas, preferências, temas e layout responsivo.

**Limites:** MVP para um administrador. OAuth com Facebook está implementado e aguarda configuração do aplicativo Meta. Adaptadores nativos Cakto/Hotmart/Kiwify, ações de escrita na Meta, push, cobrança e aplicativo mobile ainda não estão implementados. Use a API personalizada com o formato abaixo; payloads nativos de outras plataformas precisam de adaptação.

## Configuração

Copie `.env.example` para `.env`. O padrão escuta somente no loopback. Para publicar, configure senha forte, proxy reverso HTTPS e URL pública:

```dotenv
HOST=127.0.0.1
PORT=3001
PUBLIC_URL=https://track.seudominio.com.br
DATABASE_PATH=./data/wetrack.sqlite
ADMIN_PASSWORD=sua-senha-forte
```

`HOST=0.0.0.0` só é aceito com senha. Sessões ficam no banco por hash, expiram em 24 horas e podem ser usadas entre instâncias. O logout revoga a sessão. O login limita tentativas. Não há cadastro público ou recuperação de senha.

O banco fica em `data/wetrack.sqlite`. Tokens de webhook são guardados por hash. Credenciais Meta/CAPI usam AES-256-GCM com `data/secret.key`; faça backup da chave junto com o banco. Opcionalmente forneça `SECRETS_KEY` com 64 caracteres hexadecimais. Não troque a chave sem migrar credenciais existentes.

`PUBLIC_URL` determina os códigos de instalação e URLs de webhook. Em desenvolvimento, o Vite encaminha `/api` e `/pixel.js` à API.

## Meta Ads

1. Defina `META_GRAPH_VERSION` com uma versão **suportada pelo seu aplicativo Meta** e reinicie a API. O código não presume uma versão.
2. Gere um token oficial de usuário/usuário do sistema com `ads_read` e acesso às contas necessárias.
3. Em **Integrações → Meta Ads → Conectar por token**, informe o token. A WeTrack consulta `me/adaccounts` para validar o acesso e listar todas as contas.
4. **Ative apenas as contas que pertencem à operação.** Contas novas começam desativadas. Contas em outras moedas aparecem, mas não podem ser ativadas nesta versão.
5. Use **Sincronizar 30 dias** para importar campanhas, conjuntos, anúncios, custos diários e etapas do funil. A API aceita intervalos de até 90 dias. A sincronização consulta apenas contas selecionadas.

Somente contas em **BRL**, sem conversão cambial. Custos seguem as datas do relatório da conta; mantenha o fuso Meta alinhado a Brasília. Faturamento vem dos webhooks, não do valor atribuído pela Meta. Campanhas importadas aceitam atribuição pelo ID externo ou nome único na operação. Prefira IDs: nomes repetidos em contas diferentes permanecem sem atribuição automática. `ad_id` e `adset_id` identificam os níveis filhos; `utm_content={{ad.id}}` e `utm_term={{adset.id}}` também são aceitos. Uma sincronização posterior reconcilia vendas recebidas antes da importação da estrutura.

Desativar uma conta a exclui imediatamente dos relatórios, mantendo o histórico salvo. Vendas sem campanha identificada permanecem no total da operação. Custos dos níveis campanha/conjunto/anúncio nunca são somados entre si no dashboard.

Ativar/pausar uma campanha, conjunto ou anúncio na interface é uma ação **local** e não altera anúncios. Custos importados não podem ser sobrescritos pelo investimento manual. Chamadas Meta foram verificadas com transporte simulado. Validação ao vivo exige credenciais, permissões e versão válida; nenhuma conta real foi conectada no desenvolvimento.

## Conexão por link (Facebook OAuth)

O fluxo está implementado e pode ser aberto em outro navegador ou Multilogin. Para ativá-lo, publique a WeTrack com HTTPS e configure no servidor `PUBLIC_URL`, `META_GRAPH_VERSION`, `META_APP_ID` e `META_APP_SECRET`. Nunca coloque o segredo em variáveis `VITE_*`. Se usar Login do Facebook para Empresas, informe também `META_LOGIN_CONFIG_ID` de uma configuração com o acesso a anúncios necessário.

No aplicativo Meta, cadastre exatamente `https://SEU-DOMINIO/api/meta/oauth/callback` como retorno OAuth. Configure o nome público **WeTrack**, os domínios e as permissões; acesso por pessoas fora dos papéis de desenvolvimento depende da configuração e das aprovações exigidas pela Meta, incluindo `ads_read`. Apenas possuir um domínio não conclui essa configuração.

Em **Integrações → Meta Ads → Conectar com Facebook / gerar link**, gere e copie o link para o Multilogin. Ele vale por 15 minutos e é de uso único. Conclua o consentimento no mesmo navegador, volte ao painel, atualize as contas e selecione as desejadas. O retorno usa estado aleatório e cookie seguro para conferir a sessão; credenciais ficam criptografadas no servidor. O Multilogin não recebe uma sessão administrativa da WeTrack. O fluxo foi testado com transporte simulado; ainda precisa de homologação com um aplicativo Meta real.

## Campanhas, funil e visitas

- **Campanhas:** três abas: Campanhas → Conjuntos de anúncios → Anúncios. Clique no nome para avançar, use o caminho superior para voltar ou limpe a seleção. Anúncios abrem detalhes; filtros e exportação usam o nível exibido. Campanhas manuais não possuem filhos inventados.
- **Funil Meta:** cliques no link, visitas de página e checkout da Marketing API; pedidos e vendas aprovadas dos webhooks atribuídos às campanhas selecionadas. **Funil Site:** sessões, visitantes e intenção de checkout do pixel; pedidos e aprovações dos webhooks da operação. São totais do período, não uma coorte garantida de pessoas. Não há preenchimento artificial de etapas sem dados.
- **Horários:** vendas aprovadas por hora, em Brasília.
- **Visitas:** lista paginada de visitantes anônimos com origem, páginas, sessões e última atividade. **Ver trajeto** mostra páginas, seções, cliques e checkout em ordem, agrupados por sessão, além dos pedidos vinculados por `visitor_id`. O período limita os eventos exibidos. O pixel atualizado precisa estar instalado para registrar esses detalhes; não reconstrói o passado.

## Pixel

Cadastre o domínio em **Integrações → Pixel de rastreio** e instale o script no `head`, conforme o consentimento aplicável:

```html
<script
  async
  src="https://track.seudominio.com.br/pixel.js"
  data-pixel="px_SEU_ID"
  data-checkout-origin="https://pay.seucheckout.com"
></script>
```

A origem deve coincidir com a cadastrada, incluindo protocolo, subdomínio e porta. O pixel não coleta nome, e-mail, telefone ou URLs completas. Preserva parâmetros de campanha no armazenamento local, envia origem/campanha e propaga UTMs/identificadores de clique para os links HTTP. Sem armazenamento, usa um visitante temporário.

```javascript
window.WeTrack.track('InitiateCheckout');
window.WeTrack.track('Purchase');
const visitorId = window.WeTrack.visitorId;
```

Links com `data-wetrack-checkout` ou com a origem indicada em `data-checkout-origin` geram InitiateCheckout ao clicar. O código gerado pelo painel inclui a origem do checkout cadastrado. Isso registra intenção de ir ao checkout, sem observar a navegação dentro de um site de terceiros. O pixel registra mudanças de caminho em aplicações SPA, visualizações de seções `[data-wetrack-section]` ou `main section[id]`, cliques e sessões com 30 minutos de inatividade. URLs enviadas perdem parâmetros e fragmentos; formulários não são lidos. Purchase do navegador **não cria venda nem faturamento**. Vendas entram pelo webhook.

## API de vendas

Crie uma conexão em **Integrações → Webhook API**. A URL aparece uma vez. Revogar impede novos pedidos e preserva as vendas existentes.

```http
POST /api/webhooks/SEU_TOKEN
Content-Type: application/json
```

```json
{
  "order_id": "PEDIDO-1001",
  "status": "approved",
  "amount": 97,
  "product": "Meu produto",
  "customer_name": "Maria",
  "customer_email": "maria@exemplo.com",
  "payment_method": "pix",
  "utm_source": "facebook",
  "utm_campaign": "ID-ou-nome-da-campanha",
  "utm_medium": "paid",
  "utm_content": "ID-do-anuncio",
  "utm_term": "ID-do-conjunto",
  "visitor_id": "identificador-anonimo-do-pixel"
}
```

- `amount`: em **reais**, não centavos. `97` representa R$ 97,00.
- `status`: `approved`, `pending`, `refunded` ou `chargeback`.
- `payment_method`: `pix`, `credit_card` ou `boleto`.
- `order_id`: único por conexão. Reenvios atualizam valor/status sem outra venda.
- `created_at`: opcional, ISO 8601 com fuso. Sem ele, usa o recebimento. Relatórios usam a data original do pedido em Brasília.
- `visitor_id`: identificador fornecido pelo pixel. Quando a origem é `direct`, recupera o último clique pago da operação nos últimos sete dias.
- `customer_phone`: opcional, formato internacional com DDI, números e `+` inicial opcional.
- `fbp` e `fbc`: opcionais para CAPI, quando obtidos legitimamente na origem.

Responde com ID, indicação de reenvio e enfileiramento CAPI. Enfileirar não significa entregar. Apenas vendas aprovadas compõem faturamento. Lucro sobre mídia = faturamento − investimento; não inclui taxas, impostos ou custos do produto.

### CAPI

Configure o ID do pixel Meta e token ao criar o pixel WeTrack ou em **Configurar CAPI**. Use inicialmente um código de evento de teste oficial. Associe o pixel ao gerar a conexão de vendas e envie identificadores de comprador nos pedidos.

Compras aprovadas entram na fila com `event_id` estável. Reenvios não geram novas compras. E-mail e telefone são normalizados e convertidos em hash no payload. O worker roda a cada 30 segundos e tenta até cinco vezes. Em **Ver envios**, consulte falhas e solicite reenvio. Eventos sem identificador falham sem envio.

A confirmação registra recebimento pela API; não presume qualidade de correspondência ou atribuição no Gerenciador de Eventos. Não há retratação automática de uma compra já enviada quando um pedido é reembolsado.

## Estrutura

```text
src/                  React + TypeScript, interface e componentes
server/app.mjs        Express, validação e autenticação
server/db.mjs         SQLite e demonstração
server/domain.mjs     Fórmulas e validação
server/meta.mjs       Marketing API, seleção de contas, criptografia e fila CAPI
server/oauth.mjs      Autorização por link e retorno Facebook
server/reporting.mjs  Hierarquia, funil e trajetos
server/attribution.mjs Resolução de IDs e nomes sem ambiguidade
server/pixel.js       Script instalável
tests/                API, Meta e navegador
docs/                 Referências e decisões
```

## Verificação

```powershell
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Os testes de navegador iniciam serviços em portas separadas (3002/5174) e banco isolado. Para um Chromium existente, defina `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Cobrem dashboard, filtros, exportação, vendas, pixels, token/webhook, investimento, regras, instalação do script e mobile. Os testes Meta simulam o transporte e não enviam dados reais.

## Referências técnicas

- [SDK oficial de Marketing API](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/ad-account.js)
- [OAuth no SDK oficial](https://github.com/facebookarchive/php-graph-sdk/blob/5.x/src/Facebook/Authentication/OAuth2Client.php)
- [Eventos server-side no SDK oficial](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/serverside/event-request.js)
- [Análise com REA](docs/referencia-rea.md)
