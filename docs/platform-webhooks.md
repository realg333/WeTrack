# Webhooks Cakto, Hotmart e Blackcat

Documentação e contratos verificados em 18/10/2026. Os tutoriais de configuração ficam em **Integrações → Webhook API → plataforma → Tutorial**. Cada conexão pertence a uma operação e possui URL própria.

## Configuração operacional

1. Gere a conexão e copie a URL. A conexão começa em modo de teste e sem credencial.
2. Cadastre a URL na plataforma, com os produtos e eventos da operação.
3. Informe a credencial no formulário privado da WeTrack: secret do webhook Cakto, Hottok Hotmart ou API Key Blackcat. Os campos não retornam essas credenciais ao navegador depois do salvamento.
4. Envie o teste pela plataforma. Confira **Entregas**. Testes validados não criam vendas nem eventos Purchase.
5. Escolha o responsável por Purchase e só então libere vendas reais. A API exige um teste validado antes da liberação. Ao substituir a credencial, faça uma nova validação em modo de teste.

O código foi validado com transporte simulado e testes locais de navegador. Isso não comprova que a URL foi cadastrada em uma conta real das plataformas: o cadastro externo, a credencial daquela conta e uma entrega autenticada ainda são necessários.

## Contratos implementados

| Plataforma | Autenticação e integridade                                                                                                                                                                                     | Identidade da venda                                                        | Valor                                                                                                    | Eventos e estados                                                                                                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cakto      | HMAC-SHA256 de `timestamp.corpo cru`, janela de 5 minutos; comparação constante. Sem headers de assinatura, admite o `secret` documentado no corpo. Assinatura inválida nunca cai para a validação pelo corpo. | `data.id`; V2 aceita lista e preserva IDs próprios de bump/upsell          | `data.amount`, em reais, BRL; baseAmount apenas como referência quando não há cobrança aprovada          | Aprovação e renovação aprovadas; cobranças geradas pendentes; recusa cancelada; refund e chargeback terminais. Abandono, pedido de reembolso e eventos administrativos de assinatura são ignorados.                                                                          |
| Hotmart    | `X-HOTMART-HOTTOK`, comparação constante; versão 2.0.0                                                                                                                                                         | `data.purchase.transaction`; `id` identifica a entrega, não uma nova venda | `purchase.price.value`, moeda BRL. Não usa comissão ou `full_price` com encargos adicionais do comprador | APPROVED e COMPLETE contam uma vez; boleto/atraso pendentes; cancelamento/expiração cancelados; PROTEST em disputa; REFUNDED e CHARGEBACK terminais. Cancelar assinatura não estorna pagamentos. Reembolso parcial exige conciliação do valor e é rejeitado com diagnóstico. |
| Blackcat   | URL opaca da conexão e consulta obrigatória à API com `X-API-Key`; headers do webhook não são tratados como assinatura                                                                                         | `transactionId`, confirmado na API da conta                                | `amount` confirmado, inteiro em centavos, convertido uma única vez; não usa `netAmount` ou taxas         | Recebe `transaction.created`, `transaction.paid` e `transaction.failed`. O estado financeiro vem de GET `/sales/{transactionId}/status`, inclusive se divergir do corpo. Saques são ignorados.                                                                               |

Para Blackcat, a integração valida a chave com GET `/sales/seller`. Não cria cobranças, pagamentos ou saques. A moeda padrão do contrato é BRL; esta versão não consolida outras moedas nem aplica conversão cambial.

O painel Blackcat foi conferido em **Integrações → Webhooks → Adicionar** e oferece **Transação criada**, **Status alterado**, **Transação paga**, **Transação falhou** e **Transação estornada**. Selecione esses eventos em **Webhook Padrão**. A documentação pública lista apenas três eventos de transação; a WeTrack admite notificações `transaction.*`, mas sempre consulta a API antes de definir o estado financeiro, inclusive REFUNDED. Não aceita o valor ou o status financeiro declarados no webhook como comprovação. A ação **Conferir últimas 20 transações** também consulta as últimas 20 vendas já conhecidas daquela conexão e permite atualizar estornos. Não importa todo o histórico nem descobre transações desconhecidas.

## Atribuição

- Cakto entrega as cinco UTMs e pode entregar `fbc`/`fbp`. O pixel WeTrack acrescenta uma referência em `sck` nos links `pay.cakto.com.br` se esse parâmetro estiver vazio.
- Hotmart informa expressamente que não entrega UTMs estruturadas no webhook. O pixel acrescenta um código curto em `xcod` nos links `pay.hotmart.com`; `purchase.origin.xcod` recupera a referência. `src` e `sck` legados também podem identificar uma referência WeTrack ou informar a origem simples. Não inferimos cinco dimensões a partir de um texto arbitrário em SCK.
- Referências têm prefixo `wt`, usam letras e números, não contêm underline e ficam abaixo de 30 caracteres. A consulta é isolada por operação. A referência guarda visitante, UTMs e cookies Meta disponíveis e expira após 30 dias. Não lê formulários.
- `sck` e `xcod` já preenchidos são preservados. Redirecionamentos precisam manter a referência. Links diretos ao checkout, sem passagem pela página com pixel, não recebem atribuição completa automaticamente.
- Blackcat devolve `utm` quando o sistema que criou a cobrança informou as UTMs. O tutorial orienta repassar esses campos no pedido de criação e configurar `postbackUrl`. Não há inferência de visitante por e-mail nem vínculo automático com outras plataformas.
- Os IDs de campanha, conjunto e anúncio são preferidos aos nomes. Nomes de campanha repetidos não criam atribuição ambígua. Informações que chegam apenas na aprovação podem completar uma venda antes registrada como pendente.

## Duplicação de compras e CAPI

Há duas escolhas explícitas por conexão:

- **Checkout / outra integração:** a WeTrack registra as vendas e não envia Purchase dessa conexão à Meta. É a escolha inicial.
- **WeTrack:** exige pixel com CAPI e confirmação de que Purchase do checkout e outros rastreadores foram desativados para aquele pixel e aquelas compras.

Não é uma proibição geral de usar pixel Hotmart. Eventos de páginas podem continuar sendo usados conforme o desenho de rastreamento. O ponto de decisão é o mesmo Purchase enviado por fontes independentes. A Meta recomenda identificadores e nomes de evento compatíveis para deduplicação; não foi comprovada compatibilidade entre os IDs gerados pela WeTrack e os IDs nativos dos checkouts.

Pedidos repetidos da mesma plataforma na mesma operação compartilham a identidade da venda, mesmo se chegarem por duas conexões. Plataformas diferentes permanecem origens independentes, conforme o uso informado pelo responsável. Order bumps e recorrências com IDs distintos permanecem vendas distintas. O cancelamento de uma assinatura não apaga suas compras anteriores.

A fila CAPI usa ID estável. Reembolso/chargeback bloqueiam uma compra que ainda não foi enviada. Não há retratação automática de eventos já recebidos pela Meta. A data de aprovação é preservada; compras fora da janela de 7 dias ficam no histórico financeiro e não são reenviadas como se tivessem ocorrido agora. Renovações automáticas usam `system_generated`. O código de teste configurado no pixel Meta continua valendo independentemente do modo de teste do webhook.

## Recebimento, fila e retenção

O endpoint confirma a entrega depois de gravar uma entrada persistente, sem aguardar consultas Blackcat ou envio CAPI. O conteúdo necessário ao processamento fica criptografado; a fila não conserva CPF, cartão ou o secret recebido no corpo. Entregas autenticadas com formato/moeda inválidos recebem erro e diagnóstico sanitizado no histórico.

O worker usa uma reserva por entrada para evitar execução simultânea em instâncias diferentes. Há até cinco tentativas automáticas para falhas transitórias, com espera progressiva. É possível solicitar nova tentativa pelo painel enquanto o conteúdo estiver disponível. Eventos antigos e regressões de uma venda já paga para pendente/cancelada não alteram o estado financeiro; reembolso e chargeback não são substituídos por aprovações atrasadas.

Na Vercel, `waitUntil` inicia o processamento após a resposta. Também há a verificação diária da fila existente. Sem tráfego, uma retentativa que exige espera pode aguardar essa verificação ou um reenvio manual; não há processo permanente de 30 segundos na Vercel Hobby. Localmente, o worker roda a cada 30 segundos.

Conteúdos processados são removidos da fila. Pendências expiram em 7 dias; metadados técnicos expiram em 30 dias, durante a limpeza da fila. Vendas e seu histórico seguem a política de privacidade. Revogar a conexão bloqueia novos webhooks e preserva o histórico financeiro.

## Fontes oficiais

- [Cakto: guia completo de webhooks](https://docs.cakto.com.br/conceitos/webhooks)
- [Cakto: cadastrar webhook e produtos](https://docs.cakto.com.br/api-reference/webhooks/create)
- [Cakto: testar entrega](https://docs.cakto.com.br/api-reference/webhooks/test-webhook)
- [Hotmart: contrato 2.0.0](https://developers.hotmart.com/docs/en/2.0.0/webhook/purchase-webhook/)
- [Hotmart: cadastro, histórico e reenvio](https://help.hotmart.com/pt-br/article/360001491352/como-configurar-a-api-do-meu-produto-usando-o-webhook-postback-)
- [Hotmart: UTMs não entregues no webhook](https://help.hotmart.com/pt-br/article/360002403031/como-configuro-os-parametros-utm-para-rastrear-minhas-campanhas)
- [Hotmart: SRC e SCK](https://help.hotmart.com/pt-br/article/216441797/como-identificar-a-origem-das-minhas-vendas-na-hotmart-)
- [Blackcat: documentação pública completa](https://docs.blackcatoficial.com/)
- [Meta: deduplicação](https://developers.facebook.com/documentation/ads-commerce/conversions-api/deduplicate-pixel-and-server-events)
- [Meta: data e origem do evento](https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/server-event)
