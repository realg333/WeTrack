# Descomplica Libras — configuração e publicação

Operação preparada em 17/10/2026. Credencial salva criptografada no banco local, sem token em arquivos versionados.

Em 18/10/2026, o painel foi ajustado para mostrar o ID Meta e identificar o modo de teste. A verificação abaixo se refere ao evento enviado em 17/10; não foi repetido um envio de produção.

| Item                      | Configuração                         |
| ------------------------- | ------------------------------------ |
| Operação                  | Descomplica Libras (`workspace`)     |
| Domínio informado         | `descomplicalibras.shop`             |
| Origem final observada    | `https://www.descomplicalibras.shop` |
| Pixel Meta                | `4497992933816815`                   |
| Pixel WeTrack             | `px_libras_4497992933816815`         |
| Código de teste           | `TEST74475`                          |
| Versão Graph API validada | `v26.0`                              |
| Hospedagem WeTrack        | https://wetrack-psi.vercel.app   |

## Validação realizada

Um PageView de diagnóstico foi enviado diretamente à CAPI com o código de teste informado pelo usuário. A Meta respondeu HTTP 200, `events_received: 1` e `messages: []`, em 17/10/2026 às 19:31 de Brasília. Não foi criada uma venda na WeTrack e não foi enviado um Purchase de produção.

O token não autorizou as consultas de leitura ao pixel e a `me/adaccounts` (erros Meta 100/200, Missing Permission). Portanto, a CAPI foi validada, mas a importação de contas e custos não está conectada. Para isso é necessário um token com `ads_read` e acesso às contas pertinentes, informado na conexão Meta Ads. Um token restrito à CAPI não precisa ser substituído para continuar usando o envio de eventos já validado.

O site publicado já referencia o mesmo ID Meta. O script WeTrack não reinicializa o pixel do Facebook. A integração de compras com o checkout ainda precisa ser ligada e sua deduplicação deve ser conferida se outro sistema também enviar compras à Meta.

## Instalação após publicar o servidor

Nenhuma alteração foi feita no site publicado. Não instale no site o código que aponta para `127.0.0.1`: ele só funciona neste computador.

1. A WeTrack já está publicada em `https://wetrack-psi.vercel.app`, com `PUBLIC_URL` nesse endereço.
2. No site, adicione o código gerado em **Integrações → Pixel de rastreio**. A origem autorizada precisa continuar sendo `https://www.descomplicalibras.shop`.
3. Abra uma URL com UTMs e confira os eventos na WeTrack. A instalação deve respeitar o consentimento aplicável no site.

Modelo de instalação, com endereço público a substituir:

```html
<script
  async
  src="https://wetrack-psi.vercel.app/pixel.js"
  data-pixel="px_libras_4497992933816815"
  data-checkout-origin="https://pay.cakto.com.br"
></script>
```

## Checkout e vendas

Foram observados dois checkouts Cakto:

- Plano básico: `https://pay.cakto.com.br/xabq5au_1087032`
- Plano completo: `https://pay.cakto.com.br/ioqr3ew_1086923`

Nesta versão o receptor aceita o formato da API personalizada WeTrack. O payload nativo da Cakto precisa de um adaptador; não aponte um webhook nativo diretamente ao receptor atual. A URL precisa ser pública para a Cakto conseguir entregar pedidos. Não foi criado ou alterado nenhum webhook na conta Cakto.

Com o receptor público e o adaptador prontos, associe a conexão de vendas ao pixel WeTrack e valide um pedido de teste antes de ativar o fluxo de produção. Mantenha `TEST74475` durante a homologação e remova o código em **Configurar CAPI** somente quando for iniciar a produção.

## Referências

- [Documentação oficial de webhooks Cakto](https://docs.cakto.com.br/conceitos/webhooks)
- [Operação e formato da API WeTrack](../README.md)

## Atualização de campanhas e jornadas — 18/10/2026

A interface agora tem campanhas, conjuntos e anúncios navegáveis, funil Meta/Site, vendas por horário e trajetos por visitante. A demonstração inclui exemplos separados da operação real. Contas conectadas começam desativadas; selecione somente as contas da Descomplica Libras antes de sincronizar. Desativar uma conta a retira dos relatórios e preserva seu histórico.

O OAuth por link está preparado com HTTPS público, aguardando configuração do aplicativo Meta (`META_APP_ID`, `META_APP_SECRET` e, se aplicável, `META_LOGIN_CONFIG_ID`). O nome exibido pelo Facebook vem desse aplicativo. Não foi criado aplicativo nem iniciada autorização real nesta atualização.

## Vercel — 18/10/2026

Projeto `wetrack` na equipe `Wetrack`, GitHub `realg333/WeTrack` conectado, Turso Starter persistente em `iad1`. A operação e a configuração CAPI foram copiadas criptografadas; `TEST74475` permanece ativo. O ambiente publicado não contém dados de demonstração. Login, logout, API e entrega do script foram verificados no endereço público. A senha de acesso foi salva somente no arquivo privado local `data/production-access.txt`.

Os trajetos começarão após instalar o script atualizado no site público. Seções podem ser identificadas com `data-wetrack-section="precos"`. Cliques para `pay.cakto.com.br` registram intenção de checkout; o interior do checkout não fica visível automaticamente. Para relacionar o pedido ao trajeto, o adaptador de vendas precisa enviar `visitor_id`; para receita por anúncio/conjunto, envie `ad_id`/`adset_id` ou `utm_content`/`utm_term` com os IDs respectivos. Esses vínculos não são presumidos.
