# WeTrack

Aplicação de rastreamento e análise de campanhas, com interface em português, identidade própria, SQLite local e publicação na Vercel com Turso persistente. Referências de produto: LowTrack e UTMify.

## Publicação na Vercel

Site: **https://wetrack-psi.vercel.app**. Painel: **https://wetrack-psi.vercel.app/app**. Projeto `wetrack` na equipe `Wetrack`, conectado a `realg333/WeTrack` (branch `main`).

O ambiente publicado contém apenas **Descomplica Libras**. As sessões, visitas e vendas ficam no Turso Starter; arquivos temporários de Functions não são usados como banco. A senha gerada está no arquivo local privado `data/production-access.txt`, ignorado pelo Git e pelo envio à Vercel. A configuração inicial foi enviada criptografada em `WETRACK_BOOTSTRAP`; o marcador no banco impede reaplicar essa cópia sobre dados novos. O banco local e o banco publicado passam a ser independentes.

`api/index.mjs` atende `/api/*` e `/pixel.js`. O painel exige a senha própria da WeTrack; o domínio principal permite acesso ao pixel e aos webhooks. URLs individuais de deployments e previews continuam protegidas pela Vercel. As variáveis `ADMIN_PASSWORD`, `SECRETS_KEY`, `CRON_SECRET` e `WETRACK_BOOTSTRAP` existem somente em production. Previews precisam de banco e credenciais separados para usar a API.

Compras recebidas por webhook iniciam o envio CAPI com `waitUntil` depois da resposta HTTP. Há também uma verificação diária da fila às 06:00 UTC (03:00 de Brasília), compatível com o plano Hobby. Reenvios não executados por falta de tráfego aguardam a próxima verificação; não existe um processo contínuo a cada 30 segundos na Vercel.

A URL HTTPS e as variáveis do aplicativo Meta estão configuradas, com retorno `https://wetrack-psi.vercel.app/api/meta/oauth/callback`. O responsável informou conexão bem-sucedida no perfil principal. O acesso por perfis externos ainda depende das aprovações da Meta.

## Executar

A página inicial pública apresenta a oferta da WeTrack. `/app` e `/login` abrem o painel com a autenticação existente; links antigos como `/#sales` são preservados e atualizados para `/app#sales`.

O plano tem duas formas de cobrança: R$ 29,90/mês ou R$ 238,80/ano (equivalente a R$ 19,90/mês). Para habilitar o botão de assinatura, configure `VITE_CAKTO_MONTHLY_CHECKOUT_URL` e `VITE_CAKTO_ANNUAL_CHECKOUT_URL` com os links públicos das ofertas correspondentes em `https://pay.cakto.com.br/` e faça um novo build/deploy. A página valida HTTPS e o domínio do checkout; ofertas sem URL válida aparecem como “Assinaturas em breve”. Essas variáveis são públicas e nunca devem conter chaves de API. Não há provisionamento automático de contas, controle de assinatura ou webhook de cobrança SaaS; o checkout não concede acesso administrativo.

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
- Conexão Meta por OAuth, seleção de contas e importação de campanhas, custos, cliques e impressões, com paginação e atualização sem duplicação.
- Edição de nome e status de campanhas, conjuntos e anúncios na Meta, e ajuste de orçamento diário ou total no nível que já controla o orçamento, com confirmação explícita da conta e do resultado.
- Pixel com PageView, eventos manuais, autorização por domínio, identificador de visitante e preservação/propagação de UTMs por sete dias.
- API de vendas com tokens exclusivos, atualização de status, deduplicação e recuperação de atribuição pelo visitante.
- Atribuição manual das vendas por campanha, conjunto e anúncio, com consulta às UTMs recebidas, filtro de vendas sem atribuição e exportação da origem. A correção é preservada em webhooks e sincronizações posteriores.
- Padrão de UTMs para Facebook Ads pronto para copiar em Integrações → UTMs.
- Webhooks nativos Cakto V1/V2, Hotmart 2.0.0 e Blackcat, com tutoriais, credenciais criptografadas, teste sem receita, fila persistente, histórico de entregas e escolha do responsável por Purchase.
- CAPI opcional: tokens criptografados, contato com SHA-256, fila persistente, ID estável e até cinco tentativas com espera progressiva.
- Histórico de envios CAPI, confirmação de recebimento pela Meta e reenvio de falhas.
- Colunas personalizáveis em campanhas, conjuntos e anúncios, com busca, fórmulas, ordenação, seis modelos iniciais, modelos próprios por operação e exportação da seleção.
- Catálogo ampliado de métricas financeiras, tráfego, funil Meta, site, comportamento, comércio, leads e WhatsApp; taxas totais recalculadas e dados indisponíveis identificados.
- Central em **Integrações → Rastreamento**: atividade por evento/origem, smart links, referências de WhatsApp, registro manual e CAPI opcional para eventos do funil.
- **WhatsApp**: conector oficial com teste, contatos, conversas recebidas, origem por anúncio/smart link, etapas comerciais e conciliação com pedidos aprovados. Compatível com atendimento no Business do celular mediante coexistência habilitada na Meta. [Ativação e métricas](docs/whatsapp.md).
- Eventos de comércio e personalizados com propriedades, formulários marcados sem leitura de campos, vídeo HTML, primeira origem, click IDs de outras redes e API para CRM/offline.
- Recepção de pedidos no formato UTMify em `/api/compat/utmify`, com token WeTrack, modo de teste e BRL em centavos. [Contratos, fontes, fórmulas e limites](docs/metrics-and-tracking.md).
- Alertas de indicadores no painel, notificações internas, preferências, temas e layout responsivo.

**Limites:** MVP para um administrador. OAuth e gestão de anúncios exigem as permissões e o acesso aprovados pela Meta. Criação e duplicação de anúncios, edição de criativos, adaptadores de outras plataformas, push, cobrança e aplicativo mobile ainda não estão implementados. Cakto, Hotmart e Blackcat possuem conectores próprios; outras plataformas podem usar a API personalizada com adaptação do payload.

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
2. Configure o Login para Empresas com `ads_read` e `ads_management`, além dos requisitos de `public_profile`, e conecte pelo fluxo OAuth descrito abaixo.
3. Como alternativa avançada, informe um token oficial de usuário/usuário do sistema com essas permissões em **Integrações → Meta Ads → Conectar com Facebook → Conexão manual · avançado**. A WeTrack consulta `me/adaccounts` para validar o acesso e listar as contas.
4. **Ative apenas as contas que pertencem à operação.** Contas novas começam desativadas. Contas em outras moedas aparecem, mas não podem ser ativadas nesta versão.
5. Use **Sincronizar 30 dias** para importar campanhas, conjuntos, anúncios, custos diários e etapas do funil. A API aceita intervalos de até 90 dias. A sincronização consulta apenas contas selecionadas.

Somente contas em **BRL**, sem conversão cambial. Custos seguem as datas do relatório da conta; mantenha o fuso Meta alinhado a Brasília. Faturamento vem dos webhooks, não do valor atribuído pela Meta. Campanhas importadas aceitam atribuição pelo ID externo ou nome único na operação. Prefira IDs: nomes repetidos em contas diferentes permanecem sem atribuição automática. `ad_id` e `adset_id` identificam os níveis filhos; `utm_content={{ad.id}}` e `utm_term={{adset.id}}` também são aceitos. Uma sincronização posterior reconcilia vendas recebidas antes da importação da estrutura.

Desativar uma conta a exclui imediatamente dos relatórios, mantendo o histórico salvo. Vendas sem campanha identificada permanecem no total da operação. Custos dos níveis campanha/conjunto/anúncio nunca são somados entre si no dashboard.

Nos itens importados, o botão **Editar na Meta** e o controle de status abrem uma confirmação com a conta e os valores atuais consultados na Meta. É possível alterar nome, status e orçamento próprio diário ou total; anúncios individuais não possuem orçamento próprio. A edição preserva o nível que controla o orçamento e não converte entre orçamento de campanha e de conjunto. A API rejeita itens alterados desde a abertura da edição e só atualiza o cadastro local após confirmar os novos valores na Meta. Erros de comunicação podem deixar o resultado do pedido incerto: consulte os valores antes de repetir.

Campanhas manuais continuam locais. Custos importados não podem ser sobrescritos pelo investimento manual. Chamadas de gestão foram verificadas com transporte simulado; isso não substitui a validação real para análise da Meta. [Preparação da análise do aplicativo](docs/meta-access-review.md).

## Conexão por link (Facebook OAuth)

O fluxo está implementado e pode ser aberto em outro navegador ou Multilogin. Para ativá-lo, publique a WeTrack com HTTPS e configure no servidor `PUBLIC_URL`, `META_GRAPH_VERSION`, `META_APP_ID` e `META_APP_SECRET`. Nunca coloque o segredo em variáveis `VITE_*`. Se usar Login do Facebook para Empresas, informe também `META_LOGIN_CONFIG_ID` de uma configuração com o acesso a anúncios necessário.

No aplicativo Meta, cadastre exatamente `https://SEU-DOMINIO/api/meta/oauth/callback` como retorno OAuth. Configure o nome público **WeTrack**, os domínios e as permissões; acesso por pessoas fora dos papéis de desenvolvimento depende da configuração e das aprovações exigidas pela Meta, incluindo `public_profile`, `ads_read` e `ads_management` para a gestão. Apenas possuir um domínio não conclui essa configuração.

Em **Integrações → Meta Ads → Copiar link de conexão**, gere e copie o link para o Multilogin. Ele vale por 15 minutos e é de uso único. Conclua o consentimento no mesmo navegador, volte ao painel, atualize as contas e selecione as desejadas. O retorno usa estado aleatório e cookie seguro para conferir a sessão; credenciais ficam criptografadas no servidor. O Multilogin não recebe uma sessão administrativa da WeTrack. Os testes automatizados do fluxo usam transporte simulado; a autorização de cada perfil real depende da Meta.

## Campanhas, funil e visitas

Em **Integrações → UTMs → Padrão para Facebook Ads**, copie `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}` e cole no campo **Parâmetros de URL** de cada anúncio, sem `?`. A Meta substitui os parâmetros pelos IDs na veiculação. Sincronize as campanhas e instale o pixel WeTrack na página para preservar a origem até o checkout; o recebimento das UTMs depende do conector de vendas.

Em **Vendas**, use **Filtrar atribuição → Sem atribuição** para localizar pedidos que precisam de revisão. Nos detalhes, consulte as cinco UTMs e as referências recebidas, selecione campanha, conjunto e anúncio e clique em **Salvar atribuição**. É possível atribuir somente à campanha ou ao conjunto. Os seletores mostram nomes e IDs, inclusive itens pausados de contas selecionadas. Mudar a campanha limpa conjunto e anúncio; mudar o conjunto limpa o anúncio. A atribuição manual atualiza os relatórios e permanece após reenvios do webhook e sincronizações, preservando as UTMs para consulta. As UTMs de pedidos antigos que não foram armazenadas não podem ser reconstruídas.

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
  data-checkout-url="https://pay.seucheckout.com/oferta"
></script>
```

A origem deve coincidir com a cadastrada, incluindo protocolo, subdomínio e porta. O pixel não coleta nome, e-mail, telefone ou URLs completas. Preserva parâmetros de campanha no armazenamento local, envia origem/campanha e propaga UTMs/identificadores de clique para os links HTTP. Sem armazenamento, usa um visitante temporário.

```javascript
window.WeTrack.track('InitiateCheckout');
window.WeTrack.track('Purchase');
const visitorId = window.WeTrack.visitorId;
```

Links e botões com `data-wetrack-checkout`, links para Hotmart/Cakto e o endereço de `data-checkout-url` geram InitiateCheckout (IC) ao clicar. O código gerado pelo painel inclui o endereço do checkout cadastrado; o atributo antigo `data-checkout-origin` continua aceito. Isso registra intenção de ir ao checkout, sem observar a navegação dentro de um site de terceiros. O pixel registra mudanças de caminho em aplicações SPA, visualizações de seções `[data-wetrack-section]` ou `main section[id]`, cliques e sessões com 30 minutos de inatividade. URLs enviadas perdem parâmetros e fragmentos; formulários não são lidos. Purchase do navegador **não cria venda nem faturamento**. Vendas entram pelo webhook.

Em **Visitas e atribuição → Ver trajeto**, cada visita mostra o tempo com a página visível, tempo ativo estimado (pausa após 60 segundos sem interação ou com a aba oculta) e a maior rolagem. Os marcos de 25%, 50%, 75% e 100%, saídas e retornos ficam na linha do tempo. O tempo é atualizado a cada 15 segundos e ao ocultar/sair, usando `sendBeacon` com fallback para `fetch` com `keepalive`. Atualizações acumuladas são consolidadas por visita, sem somar o mesmo tempo repetidamente. Visitas anteriores à atualização não têm essas medidas.

`CheckoutReturn` marca a volta ao site/aba depois de um clique de checkout seguido de saída, inclusive ao usar o botão voltar (com ou sem restauração pelo cache do navegador). A intenção fica no armazenamento da aba por até 24 horas. Esse evento não comprova quanto tempo o visitante permaneceu no checkout nem abandono de compra. Para acompanhar os passos dentro de um checkout externo, use a integração da plataforma ou instale um pixel autorizado nesse domínio. O mesmo visitante depende do armazenamento do navegador; bloqueadores, troca de dispositivo e restrições de armazenamento podem impedir ou separar registros.

## API de vendas

Para **Cakto, Hotmart e Blackcat**, escolha o conector próprio em **Integrações → Webhook API → Conectar plataforma**. Cada um oferece abas Configuração, Tutorial e Entregas. A URL é recuperável pelo administrador; as credenciais da plataforma não são reveladas após o salvamento. Comece em teste e escolha um único responsável por Purchase. Veja [contratos, atribuição e limites dos conectores](docs/platform-webhooks.md).

A Blackcat usa somente consultas GET para confirmar as transações. A Hotmart não entrega UTMs estruturadas no webhook; o script WeTrack usa uma referência curta em `xcod` para recuperar a visita quando o link passa pela página própria. Reinstalação não é necessária se o site já carrega `/pixel.js` da WeTrack, mas versões copiadas do script precisam ser atualizadas. Código de teste CAPI e modo de teste do webhook são configurações independentes.

O formato abaixo se aplica à **API personalizada**.

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
server/management.mjs Edição na Meta com confirmação e revisão dos valores
server/platforms.mjs Conexões nativas, autenticação e fila de webhooks
server/platform-adapters.mjs Contratos Cakto, Hotmart e Blackcat
server/sales.mjs      Registro idempotente das vendas nativas
server/reporting.mjs  Hierarquia, funil e trajetos
server/attribution.mjs Resolução de IDs e nomes sem ambiguidade
server/pixel.js       Script instalável
tests/                API, Meta e navegador
docs/                 Referências e decisões
```

## Regras de campanhas

Em **Regras e alertas → Nova regra**, escolha um modelo ou combine até cinco condições com **E**. Exemplo: investimento **maior que R$ 100** e vendas aprovadas **menores que 2** → **Corte definitivo**. Os valores dos modelos são exemplos editáveis; regras de veiculação começam desativadas. Use **Simular regra**, confira o período e as campanhas e marque **Ativar ao salvar** quando estiver pronta.

- **Alertar** registra o resultado no painel. **Pausar campanha** confirma `PAUSED` na Meta. **Corte definitivo** também pausa, mas bloqueia a reativação por regras; a retomada exige ativação manual na gestão Meta. Excluir ou desativar a regra não desfaz suas ações.
- **Religar campanha** retoma somente campanhas pausadas pelas regras. Campanhas pausadas manualmente e cortes definitivos ficam protegidos. Uma condição de corte/pausa ainda atingida impede a retomada. O intervalo de segurança evita alternâncias entre ações.
- Cada regra usa seu próprio período (hoje, ontem, 3, 7 ou 30 dias), em Brasília, independentemente do filtro do dashboard. Vendas são pedidos aprovados atribuídos à campanha na WeTrack; pendências, reembolsos e vendas sem atribuição não contam. CPA sem vendas, ROAS sem gasto, CPC sem cliques e CTR sem impressões não disparam condições. Para zero vendas, combine gasto com vendas iguais a zero.
- Escopo vazio inclui todas as campanhas da operação; a seleção permite restringir campanhas específicas. Somente campanhas Meta de contas selecionadas, ativas e em BRL recebem ações reais. Campanhas locais permitem alertas e simulação.
- O horário diário usa Brasília e abre uma janela de 60 minutos. A regra executa na primeira verificação nessa janela, respeitando as condições e o intervalo de segurança. Reativação por horário acontece no máximo uma vez por campanha ao dia.

O servidor sincroniza custos e confirma o estado da Meta antes de alterar a veiculação. Falha na sincronização impede decisões com dados antigos. O histórico registra campanhas, indicadores, sucesso, falhas e bloqueios; uma resposta não confirmada da Meta não aparece como sucesso. Atrasos no agendador, nos custos e na atribuição significam que o limite não é um teto instantâneo de gasto.

Na Vercel Hobby, o workflow `.github/workflows/campaign-rules.yml` chama o endpoint protegido `/api/internal/rules-run` a cada cinco minutos. Configure com `node scripts/configure-rules-scheduler.mjs <caminho-do-vc.js>`: ele cria uma chave privada em `data/rules-scheduler.json`, configura `RULES_CRON_SECRET` na Vercel e `WETRACK_RULES_CRON_SECRET` nos secrets do repositório, sem imprimir valores. Faça um novo deploy após configurar. O workflow não faz checkout nem executa código de PRs e não tem permissões de escrita. Disparos manuais em GitHub Actions usam o modo de diagnóstico por padrão (`check_only=true`), que verifica autenticação e banco sem executar regras; os disparos agendados executam normalmente. [O agendamento do GitHub pode atrasar e é desativado após 60 dias sem atividade em repositórios públicos](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). Durante o uso do painel há uma verificação adicional, e o servidor local mantém seu próprio worker.

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
