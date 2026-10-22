# Ativação do WhatsApp oficial na Meta

Guia conferido na documentação oficial em **22/10/2026**. A configuração e a aprovação na Meta continuam necessárias mesmo com o código da WeTrack publicado. A conexão deve ser validada com um número real e uma mensagem de teste antes de ser considerada operacional.

## Aplicativo atual ou novo

Para uso da própria empresa, a Meta permite desenvolver com acesso Standard, sem App Review ou acesso Advanced. Isso não concede automaticamente coexistência: esse onboarding tem requisitos próprios.

Para conectar números de clientes de outras empresas, configure a WeTrack como **Tech Provider** ou utilize um Solution Partner. É necessário um aplicativo ligado ao portfólio empresarial, com o caso de uso WhatsApp, verificação da empresa e aprovação das permissões. A documentação oficial não exige criar outro aplicativo em todos os casos. É possível aproveitar o atual se o painel permitir os produtos e configurações exigidos; o ID e o segredo devem corresponder ao aplicativo que receberá os webhooks.

Fonte: [Tech Provider — Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers) e [App Review — Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review).

## Preparação no painel Meta

1. No aplicativo, abra o caso de uso WhatsApp e o onboarding de Tech Provider. Conclua a verificação do negócio vinculado.
2. Preencha os dados básicos, ícone, categoria e política de privacidade do aplicativo. Solicite acesso Advanced a `whatsapp_business_management` e `whatsapp_business_messaging` para atender outras empresas.
3. Prepare uma descrição do uso e um vídeo separado por permissão: gerenciamento/criação de template e envio de mensagem recebida em um cliente WhatsApp. A Meta admite demonstrar essas operações com WhatsApp Manager e o cURL de teste do painel.
4. Crie uma configuração em **Facebook Login for Business → Configurations**, com a variação Embedded Signup e o produto Cloud API. Copie o `config_id`.

Selecionar os produtos em uma configuração nova habilita a experiência **v4**. As versões v2/v3 foram descontinuadas em 15/10/2026. A versão do fluxo é diferente da versão da Graph API e de `sessionInfoVersion`.

Fontes: [Revisão do aplicativo — Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review), [Embedded Signup v4 — Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4).

## Domínio, servidor e início do fluxo

Configure a URL pública HTTPS da WeTrack. Em Facebook Login for Business, habilite o login OAuth do cliente, web, navegador incorporado e SDK JavaScript, com HTTPS e modo estrito. Cadastre o domínio e a URL exata da página que abre o fluxo nos campos de domínios permitidos e redirecionamentos OAuth válidos.

O servidor precisa do ID, segredo, versão Graph suportada e ID da configuração WhatsApp. O segredo nunca deve ir para `VITE_*`, HTML, resposta da API ou logs.

Opções do SDK para coexistência em v4:

```js
FB.login(receiveAuthorizationCode, {
  config_id: configurationId,
  response_type: 'code',
  override_default_response_type: true,
  extras: {
    setup: {},
    featureType: 'whatsapp_business_app_onboarding',
    sessionInfoVersion: '3',
  },
});
```

O callback entrega `authResponse.code`. O evento de sessão usa `WA_EMBEDDED_SIGNUP`; coexistência concluída usa `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`. Os IDs chegam em `data`, incluindo `waba_id` e, conforme o fluxo, `phone_number_id`. Esses retornos podem chegar em ordens diferentes. O código expira em **30 segundos**: troque-o no servidor imediatamente e associe os ativos à sessão autenticada. Aceite `postMessage` apenas de origens Meta válidas, verificando o hostname completo.

Fonte: [Implementação Embedded Signup — Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation).

## Finalização no servidor e coexistência

O backend troca o código com `GET /{version}/oauth/access_token`, enviando `client_id`, `client_secret` e `code`. O exemplo oficial deste fluxo não inclui `redirect_uri`. O token retornado é de integração empresarial; mantenha-o criptografado. Valide o número e os ativos autorizados, e inscreva o aplicativo com `POST /{waba_id}/subscribed_apps`.

**Coexistência não usa `/{phone_number_id}/register`**: o número já está registrado. O modo Cloud API tradicional possui uma etapa de registro diferente. Confira `is_on_biz_app=true` e `platform_type=CLOUD_API` no número para diagnosticar coexistência.

O cliente deve usar WhatsApp Business compatível e concluir o fluxo próprio da Meta. Grupos não são sincronizados. Após o onboarding, inicie em até 24 horas as duas solicitações a `POST /{phone_number_id}/smb_app_data`, com `messaging_product: "whatsapp"`:

- `sync_type: "smb_app_state_sync"` para contatos;
- `sync_type: "history"` para histórico autorizado.

Essas solicitações são únicas por onboarding; guarde os `request_id`. A resposta positiva indica aceitação, não conclusão. A recusa de histórico chega pelo código `2593109`; não deve ser apresentada como importação concluída. Histórico antigo não deve criar conversas novas ou receita fictícia na WeTrack.

Fontes: [Onboarding Tech Provider — Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider), [Coexistência — Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).

## Webhooks e teste real

Assine `messages`, `account_update`, `history`, `smb_app_state_sync` e `smb_message_echoes`. Configure o callback padrão do aplicativo e seu token de verificação. `account_update` sempre vai ao callback padrão, inclusive quando existe um callback alternativo por número. O backend deve rotear eventos de conta pelo ID da conta e conferir a assinatura do corpo recebido.

Teste uma mensagem recebida, um eco da resposta feita pelo Business e um pedido aprovado com telefone ou visitante conciliável. Confira origem, etapa e valor. Só depois ative a coleta real. Verifique também cancelamento do fluxo, token recusado e desconexão do parceiro.

Fontes: [Coexistência — Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users), [Callbacks alternativos — Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override).

## O que significa estar equivalente à Utmify

A [página oficial de planos da Utmify](https://app.utmify.com.br/precos) confirma rastreamento WhatsApp e conexões por número, mas não fornece uma especificação pública suficiente para afirmar equivalência integral. Na WeTrack, a comprovação exige testar o caminho anúncio/link → mensagem recebida → contato → pedido aprovado → relatório, além da conexão e reconexão de números reais.

O conector não transforma conversa ou comprovante em faturamento. O envio de conversões de WhatsApp à Meta também é uma entrega separada: a [tabela de produtos v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4#required-assets-and-permissions) lista `whatsapp_business_manage_events` para Conversions API de CTWA. Solicite produtos e permissões apenas quando essa funcionalidade estiver implementada e demonstrável.
