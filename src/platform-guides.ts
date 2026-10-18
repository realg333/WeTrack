export type Provider = 'cakto' | 'hotmart' | 'blackcat';
export const platformGuides = {
  cakto: {
    name: 'Cakto',
    credential: 'Secret do webhook Cakto',
    credentialHint: 'Use o secret da configuração deste webhook, não o client_secret da API.',
    panel: 'https://app.cakto.com.br/dashboard/apps',
    steps: [
      'Gere a URL aqui e mantenha o modo de teste. Na Cakto, abra Integrações → Webhooks → Criar Novo Webhook.',
      'Nomeie a conexão como WeTrack, cole a URL e selecione somente os produtos desta operação. O webhook não inclui automaticamente todos os produtos.',
      'Escolha compra aprovada, Pix gerado, boleto gerado, compra recusada, reembolso e chargeback. Para recorrências, inclua assinatura renovada. V1 e V2 são aceitas; no V2, cada pedido do lote é tratado pelo próprio ID.',
      'Salve na Cakto, copie o secret desse webhook e informe em Configuração aqui. Se o painel permitir definir a chave, use exatamente o mesmo valor nos dois lados.',
      'Na Cakto, abra as ações do webhook → Enviar evento de teste. Confira a entrega na aba Entregas da WeTrack. O exemplo da Cakto é fixo e não representa uma venda real.',
      'Depois de validar a entrega, desative o modo de teste aqui e confirme a liberação. Na Cakto, acompanhe o Histórico de Eventos e reenvie manualmente falhas quando necessário.',
    ],
    attribution:
      'A Cakto entrega as cinco UTMs e, quando disponíveis, fbp e fbc. Use IDs da Meta em utm_campaign, utm_term e utm_content. O script WeTrack instalado na página própria preserva os parâmetros e acrescenta uma referência de visitante em sck nos links pay.cakto.com.br quando esse campo está vazio. Um sck existente é preservado. Confira se os parâmetros chegaram ao checkout. Order bump e upsell têm IDs próprios e são vendas distintas.',
    notes:
      'Pix/boleto gerado fica pendente, sem receita nem Purchase. Abandono, pedido de reembolso e cancelamento da assinatura não viram venda aprovada nem estorno automático. initiate_checkout não é entregue pelo webhook Cakto. O recebimento responde após gravar a entrega; o processamento ocorre em segundo plano.',
    sources: [
      ['Guia e contrato completo do webhook', 'https://docs.cakto.com.br/conceitos/webhooks'],
      [
        'Cadastro e seleção de produtos/eventos',
        'https://docs.cakto.com.br/api-reference/webhooks/create',
      ],
      ['Teste de entrega', 'https://docs.cakto.com.br/api-reference/webhooks/test-webhook'],
    ],
  },
  hotmart: {
    name: 'Hotmart',
    credential: 'Hottok da Hotmart',
    credentialHint:
      'Em Ferramentas → Webhook → Autenticação. Não é Client Secret nem access token OAuth.',
    panel: 'https://app.hotmart.com/tools/webhook',
    steps: [
      'Gere a URL aqui, mantenha o modo de teste e copie o Hottok em Hotmart → Ferramentas → Webhook (API e notificações) → Autenticação. Salve esse Hottok em Configuração aqui.',
      'Na Hotmart, abra Minhas configurações → Cadastrar Webhook. Informe um nome e cole a URL gerada pela WeTrack.',
      'Selecione a versão 2.0.0 e os produtos desta operação. Escolha compra aprovada, compra completa, boleto/aguardando pagamento, compra atrasada, cancelada, expirada, reembolsada, protesto e chargeback, conforme as opções disponíveis.',
      'Salve. Nas ações da configuração, execute um teste de envio. Confira em Entregas aqui. O teste pode conter dados de exemplo; em modo de teste ele não altera o faturamento e não envia Purchase.',
      'Confira o responsável pelo Purchase abaixo. Se a WeTrack for enviar pela CAPI, desative o Purchase nativo da Hotmart para o mesmo pixel. Não mantenha duas integrações independentes enviando a mesma compra.',
      'Após validar o teste, desative o modo de teste aqui e confirme. No Histórico da Hotmart, confira respostas e eventuais reenvios. Reenviar a mesma transação não cria uma segunda venda.',
    ],
    attribution:
      'A Hotmart não entrega as UTMs estruturadas no webhook. Na sua página própria, o pixel WeTrack acrescenta um código curto em xcod nos links pay.hotmart.com quando esse campo está vazio. A venda usa purchase.origin.xcod para recuperar campanha, conjunto, anúncio e visitante. Preserve o código até o checkout; valide com uma compra autorizada. Um xcod já existente não será sobrescrito. Tráfego direto ao checkout ou redirecionamentos que removam esse código não ganham atribuição completa automaticamente.',
    notes:
      'Aprovação e conclusão da mesma transaction representam uma única venda. Usamos purchase.price.value em BRL (valor da oferta na compra), não a comissão nem full_price, que pode incluir encargos. Recorrências e order bumps com transações próprias ficam separados. Cancelar assinatura não reembolsa parcelas anteriores. Reembolso parcial exige conciliação e não é tratado como devolução integral.',
    sources: [
      [
        'Eventos de pedido 2.0.0 e Hottok',
        'https://developers.hotmart.com/docs/en/2.0.0/webhook/purchase-webhook/',
      ],
      [
        'Passo a passo e histórico',
        'https://help.hotmart.com/pt-br/article/360001491352/como-configurar-a-api-do-meu-produto-usando-o-webhook-postback-',
      ],
      [
        'Limitação das UTMs no webhook',
        'https://help.hotmart.com/pt-br/article/360002403031/como-configuro-os-parametros-utm-para-rastrear-minhas-campanhas',
      ],
      [
        'Origem e códigos de rastreamento',
        'https://help.hotmart.com/pt-br/article/216441797/como-identificar-a-origem-das-minhas-vendas-na-hotmart-',
      ],
    ],
  },
  blackcat: {
    name: 'Blackcat',
    credential: 'API Key da Blackcat',
    credentialHint:
      'Chave disponível no painel Blackcat. A WeTrack usa apenas consultas GET para validar transações; não cria cobranças nem saques.',
    panel: 'https://docs.blackcatoficial.com/',
    steps: [
      'Gere a URL aqui e mantenha o modo de teste. Informe a API Key em Configuração; a WeTrack valida a chave com uma consulta aos dados do vendedor.',
      'No painel Blackcat, abra a configuração de webhooks, cadastre uma conexão WeTrack e cole a URL gerada aqui. Use a área disponível na sua conta; a documentação pública não especifica os nomes dos menus. Para integrações diretas por API, a alternativa documentada é informar a URL em postbackUrl ao criar a venda.',
      'Selecione transaction.created, transaction.paid e transaction.failed, ou os rótulos correspondentes de transação criada, paga e falha. Não é necessário assinar eventos de saque.',
      'Ao criar a transação, envie os campos utm_source, utm_medium, utm_campaign, utm_content e utm_term para a Blackcat. Os webhooks os devolvem no objeto utm.',
      'Para validar, use uma transação existente autorizada ou o recurso de teste disponível no seu checkout. A WeTrack precisa localizar esse transactionId na API Blackcat; um JSON com ID fictício não comprova uma venda.',
      'Confira Entregas aqui. Após a validação, desative o modo de teste e confirme. Uma URL configurada só em cobranças novas não recupera automaticamente as vendas antigas.',
    ],
    attribution:
      'A Blackcat é uma origem independente de vendas nesta operação. Na criação da cobrança pelo seu checkout, repasse as UTMs capturadas na página própria. A WeTrack lê o objeto utm do webhook. O postbackUrl não transfere as UTMs sozinho. O contrato de status não garante nome do produto; a lista identifica esses pedidos como Venda Blackcat.',
    notes:
      'Os valores Blackcat são centavos e são convertidos para reais uma única vez. Usamos amount, não netAmount ou fees. A documentação não publica assinatura criptográfica para os webhooks: os headers X-Webhook-Source e X-Webhook-Event não provam a origem. Antes de registrar, a WeTrack consulta o status e o valor pelo transactionId usando a API Key. A consulta admite REFUNDED, mas o catálogo não documenta um evento de reembolso. Em Entregas, use Conferir últimas 20 transações para reconciliar as vendas já conhecidas, inclusive estornos. Isso não importa vendas desconhecidas nem todo o histórico. Não compartilhe a URL do webhook.',
    sources: [
      ['Documentação completa, postbackUrl, status e eventos', 'https://docs.blackcatoficial.com/'],
    ],
  },
} as const;

export const purchaseGuidance =
  'Escolha um único responsável por Purchase para o mesmo pixel e compra. Se a WeTrack enviar pela CAPI, desative o Purchase nativo do checkout e de outros rastreadores. PageView e InitiateCheckout podem continuar onde fizerem sentido. Se não conseguir desativar só a compra no checkout, mantenha Purchase no checkout e use a WeTrack apenas para registrar as vendas. Duas fontes só devem enviar o mesmo evento com event_name e event_id compatíveis e deduplicação validada; a WeTrack não presume compatibilidade com os IDs nativos dessas plataformas.';
