# Colunas e rastreamento

Implementação de 21/10/2026. A avaliação considerou os recursos públicos da [UTMify](https://www.utmify.com.br/), a [central do Metrito](https://metrito.com/help/) e a [descrição dos módulos da LowTrack](https://lowtrack.com.br/terms). Essas referências orientam os tipos de coleta; não constituem uma alegação de paridade com todas as integrações dos fornecedores.

## Personalizar relatórios

Em **Campanhas → Colunas**, escolha métricas, busque pelo nome ou fórmula, altere a ordem pelas setas e aplique. Existem cinco seleções iniciais e até vinte modelos próprios. A seleção e os modelos são persistidos no banco por operação e compartilhados por campanhas, conjuntos e anúncios. Cancelar descarta as alterações. Status, identificação e ações permanecem fixos.

Os cabeçalhos ordenam os resultados. A exportação mantém identificação e as métricas escolhidas, na mesma ordem, com valores numéricos sem formatação. Nomes que poderiam ser interpretados como fórmulas de planilha são escapados pelo exportador existente.

O catálogo cobre resultados financeiros, todos os cliques e cliques no link, custos, impressão, etapas do funil Meta, sessões, visitantes, conteúdo, carrinho, checkout, comportamento, vídeo, formulários, leads e relacionamento. Cada opção informa sua fórmula e fonte. A [distinção entre fonte Meta e fonte própria](https://metrito.com/help/articles/campanhas-3-3-diferencas-entre-colunas-do-meta-e-do-metrito/) também é importante ao comparar resultados.

As taxas do rodapé são recalculadas com os totais dos componentes, nunca pela média das taxas das linhas. Médias de tempo, rolagem e orçamento ficam sem total. Visitantes únicos são contados por entidade; o mesmo visitante pode aparecer em várias entidades. Totais de etapas do período não representam uma coorte de pessoas. Divisões sem denominador e indicadores Meta sem importação aparecem como `—`. Ausência de evento de uma categoria é contada como zero, não como prova de que o script dessa categoria já foi instrumentado.

**Lucro sobre mídia** continua sendo receita aprovada menos investimento. ROI e margem têm a mesma base; não descontam impostos, gateway, comissões ou produto. Receita usa o status atual e a data original do pedido. Reembolso não é subtraído outra vez de uma receita que já exclui esse pedido.

O alcance de vários dias não pode ser obtido somando alcances diários; alcance, frequência, métricas de leilão, nota de correspondência e conversões de outras redes não são inventados nem calculados a partir de estimativas. Ainda não há esses indicadores no catálogo.

## Tipos de coleta disponíveis

| Tipo                | Implementação                                                                                        | Configuração necessária                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Navegação           | Páginas SPA, sessões, seções, cliques, tempo visível/ativo estimado, rolagem e retorno do checkout   | Pixel autorizado no domínio, instalado após consentimento aplicável                                         |
| Comércio            | ViewContent, AddToCart, AddToWishlist, InitiateCheckout, AddPaymentInfo e Search                     | Chamar `WeTrack.track` ou marcar botões com `data-wetrack-event`                                            |
| Leads               | Lead, Contact, CompleteRegistration, Schedule e SubmitApplication                                    | Confirmar a ação na página ou enviar pelo CRM                                                               |
| Recorrência         | Subscribe e StartTrial                                                                               | Evento pela página/API; cada cobrança financeira precisa de pedido próprio no webhook                       |
| Formulário          | FormSubmit sem ler campos                                                                            | `form[data-wetrack-form]`; é tentativa de envio, não cadastro confirmado                                    |
| Vídeo               | Reproduções, marcos de 25/50/75% e conclusão                                                         | `video[data-wetrack-video]`; players em iframe precisam de integração própria                               |
| Personalizado       | Nome ASCII com 2–64 caracteres; valor BRL, ID e nome de conteúdo opcionais                           | `WeTrack.track('MinhaConversao', detalhes)` ou API                                                          |
| WhatsApp            | Cliques e referências no texto; conector oficial de mensagens recebidas, etapas e pedidos vinculados | Coexistência habilitada pela Meta para continuar no Business do celular; [ativação e fórmulas](whatsapp.md) |
| Smart link          | Redirecionamento de destino fixo, UTMs, cookie pseudônimo e referência                               | Criar em Integrações → Rastreamento; preservar referência no checkout/CRM                                   |
| Server-side/offline | API autenticada para eventos e registro manual no painel                                             | Token de API personalizada, pixel da mesma operação, ID estável e visitante/referência                      |
| Vendas              | Webhook de API personalizada; Cakto, Hotmart e Blackcat nativos                                      | Conectar plataforma, validar teste, escolher um responsável por Purchase                                    |
| Formato UTMify      | Pedidos BRL com produtos, centavos, UTMs e estados de pagamento                                      | Endpoint compatível, token WeTrack e URL configurável no emissor                                            |
| CAPI                | Compras confirmadas já existentes; funil padrão opcional e eventos personalizados via servidor       | Pixel/token Meta, envio habilitado e deduplicação coordenada com outras ferramentas                         |

O [Metrito descreve smart links e preservação de parâmetros](https://metrito.com/help/articles/trackeamento-1-5-links-de-redirect-smart-links/); a [LowTrack descreve CAPI, identificadores e atribuição entre sessões](https://lowtrack.com.br/). A WeTrack implementa esses mecanismos com as limitações explicitadas acima: não garante coleta diante de bloqueadores ou restrições do navegador.

## API de eventos

```http
POST /api/track-events
Authorization: Bearer SEU_TOKEN_WETRACK
Content-Type: application/json
```

```json
{
  "pixel_id": "px_SEU_ID",
  "event_id": "crm-contato-1001",
  "visitor_id": "identificador-original-do-pixel",
  "event_name": "Contact",
  "utm_source": "facebook",
  "utm_campaign": "ID_DA_CAMPANHA",
  "utm_term": "ID_DO_CONJUNTO",
  "utm_content": "ID_DO_ANUNCIO",
  "send_capi": false
}
```

`attribution_code: "wt..."` pode substituir o visitante e recuperar as UTMs da referência, restrita à operação e à validade de trinta dias. Sem referência, a API pode recuperar o último evento pago do visitante em sete dias. O nome, pixel e `event_id` devem ser estáveis entre reenvios; a deduplicação usa operação, pixel e ID. Tokens revogados não funcionam. Campos de contato enviados explicitamente à API são usados em hash na CAPI e não são armazenados em `event_signals`.

`created_at` aceita ISO com fuso; eventos futuros além de cinco minutos são rejeitados. `action_source` aceita website, system_generated (padrão), chat ou physical_store. `value` é propriedade do evento, não receita. `Purchase` é rejeitado nesta API: use o webhook financeiro para preservar aprovação, deduplicação, estornos e relatórios.

No navegador, `WeTrack.track` retorna um ID e aceita `event_id` fornecido pela aplicação. Para deduplicar com outro pixel Meta, use exatamente o mesmo ID e nome do evento. Ativar o funil CAPI não envia eventos antigos nem duplica o envio financeiro de Purchase. Eventos internos de tempo, rolagem, clique e saída não são enviados automaticamente à CAPI. O aceite da API não garante atribuição ou qualidade de correspondência. A fila segue as tentativas e o agendamento já existentes; a Vercel não mantém um worker contínuo.

## Formato de pedidos compatível

```http
POST /api/compat/utmify
x-api-token: SEU_TOKEN_WETRACK
Content-Type: application/json
```

O formato documentado por integrações como a [PlayPayments](https://app.playpayments.com.br/docs) contém `orderId`, `platform`, `paymentMethod`, `status`, `createdAt`, `customer`, `products`, `trackingParameters` e `commission`. São aceitos `waiting_payment`, `paid`, `refused`, `refunded` e `chargedback`. `totalPriceInCents` representa o total bruto; `isTest: true` valida sem criar venda. Datas `YYYY-MM-DD HH:MM:SS` são UTC. Outras moedas são rejeitadas. O padrão `nome|ID` identifica entidades importadas; as UTMs recebidas são preservadas para consulta. `trackingParameters.sck` ou `src` podem carregar uma referência WeTrack.

Este endpoint não conecta uma conta UTMify nem altera endpoints fixos de gateways. Plataformas que não permitem mudar o endereço precisam de um adaptador no servidor. Não encaminhe o token de outro fornecedor: use o token gerado pela WeTrack. Configure uma conexão por fluxo de pedidos para evitar importar a mesma venda por conexões diferentes.

## Atribuição e limites

Primeira origem é preservada por trinta dias para consulta no trajeto; último clique por sete dias. O modelo financeiro existente continua usando a última origem disponível e correções manuais. Referências explícitas de checkout/WhatsApp têm validade de trinta dias. Identificadores capturados e propagados: fbclid, gclid, ttclid, msclkid, gbraid, wbraid e kwai_click_id. Capturar esses identificadores não significa enviar conversões às respectivas redes.

O pixel cria/lê FBP e FBC após ser carregado; a instalação deve respeitar a autorização do site. Não lê valores dos formulários nem cruza pessoas por impressão digital. Smart links e links de checkout podem transportar o visitante e uma referência até outro domínio autorizado com o pixel, permitindo continuidade no mesmo navegador. Troca de dispositivo, cookies indisponíveis ou remoção do código quebram esse vínculo. Redirecionamentos também podem registrar robôs e prévias de links.

Continuam fora do escopo: interpretação de mensagens e comprovantes como pagamento, subdomínio first-party com provisionamento DNS, envio de conversões Google/TikTok/Kwai, adaptadores nativos para todos os gateways anunciados pelos concorrentes, importação do histórico deles, atribuição cross-device e regras de reembolso na Meta. O [conector oficial WhatsApp](whatsapp.md) recebe eventos assinados, sem guardar corpos de mensagem; exige ativação na Meta. Para outros CRMs e vendas offline, o emissor precisa enviar o contrato documentado.

As novas tabelas são criadas de forma aditiva no SQLite e no Turso. A atualização não reinicia o bootstrap nem reescreve os pedidos existentes.
