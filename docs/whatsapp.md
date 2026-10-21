# WhatsApp Business no celular

O painel **WhatsApp** acompanha contatos, conversas recebidas e pedidos do checkout. O atendimento continua no aplicativo Business quando o número estiver habilitado para **coexistência com a Cloud API**, conforme a elegibilidade da Meta. Não é necessário usar WhatsApp Web.

## Ativação

1. Habilite o número pelo fluxo de coexistência da Meta ou de um provedor autorizado. O cadastro na WeTrack não faz esse onboarding e não habilita WhatsApp pessoal. Use um aplicativo Meta ao qual você tenha acesso de configuração.
2. Configure `PUBLIC_URL` com HTTPS e `META_GRAPH_VERSION` com uma versão suportada pelo aplicativo. Cadastre um pixel ativo da operação.
3. Em **WhatsApp → Conexões → Configurar API oficial**, informe WABA ID, Phone Number ID, token de acesso e segredo do aplicativo Meta. Token e segredo precisam pertencer ao aplicativo usado para receber as entregas. As credenciais são criptografadas com a chave do servidor.
4. Abra **Configuração e entregas** e valide o acesso. O token deve ter acesso ao número e à conta, com permissões `whatsapp_business_management` e `whatsapp_business_messaging`.
5. Configure Webhooks → WhatsApp Business Account no aplicativo Meta. Use a URL e o token exibidos pela WeTrack para validar o callback e assine `messages`; para ecos das respostas feitas no aplicativo, assine também `smb_message_echoes`, quando disponível.
6. Clique em **Conectar entregas deste número**. A WeTrack inscreve o aplicativo na WABA e define o callback específico do número. Essa ação configura o recebimento de eventos; não registra, migra, desregistra ou envia mensagens pelo número.
7. Envie uma mensagem de outro telefone e confira o histórico de entregas em teste. O teste armazena somente contagens. Depois de acesso, inscrição e URL confirmados, ative a coleta real e envie outra mensagem. Testes não são importados retroativamente.

O painel não promete coexistência para toda conta nem faz login incorporado da Meta. A conexão depende do onboarding, dos acessos e das permissões disponíveis. Uma conexão existente pode ser desativada sem apagar o histórico; atualizar credenciais retorna ao modo de teste e exige nova validação e conexão das entregas.

## Contatos, origem e etapas

- Somente mensagem recebida válida inicia conversa. Cliques, notificações de status, reações, ecos de respostas e cadastro manual não iniciam conversa. IDs de mensagens são deduplicados por conexão.
- Uma conversa é uma sessão de atendimento, renovada após 24 horas sem mensagem recebida ou uma nova origem identificada diferente. Essa definição não representa cobrança da Meta. Respostas no celular são contadas quando a Meta disponibiliza os ecos, sem gerar conversas novas.
- Anúncios Click to WhatsApp podem trazer `referral.source_id` e `ctwa_clid`. A WeTrack associa o anúncio à hierarquia importada quando disponível. Smart links podem levar uma referência `wt...` no texto pré-preenchido; ela precisa chegar na mensagem recebida para recuperar visitante e UTMs. Sem evidência, a origem fica não identificada.
- As etapas **Novo contato**, **Qualificado**, **Negociando** e **Perdido** são manuais e têm histórico. Qualificar um contato com conversa emite `Lead` uma única vez por contato para a jornada interna. Não há envio automático desses eventos à CAPI neste conector.
- **Comprou** é derivado de pedido aprovado do checkout. A WeTrack não interpreta texto, áudio ou comprovante como pagamento.

## Pedidos e métricas

Webhooks de vendas personalizados e conectores nativos guardam um hash do telefone com DDI para conciliação. O vínculo automático usa primeiro o identificador de visitante e depois o telefone, dentro da operação e com uma conversa anterior ao pedido em até 30 dias. Pedidos anteriores à instalação que não tenham esses sinais podem ser vinculados manualmente. O vínculo preserva o valor, status e atribuição financeira do pedido. Desvincular impede que a conciliação automática o associe novamente.

Os cards mostram conversas iniciadas, contatos ativos/cadastrados/com compra no período, custo por conversa atribuída, conversão de conversa, pedidos aprovados e receita vinculada. O período usa dias de Brasília.

Contatos e conversas abrangem a operação. Compras, conversão e valores seguem a moeda selecionada (BRL ou USD), sem conversão cambial. O custo usa somente investimento e conversas atribuídas a campanhas da moeda escolhida. Nos detalhes e na busca de pedidos, cada valor é exibido na moeda original do pedido.

- **Custo por conversa atribuída:** investimento no período das campanhas visíveis identificadas nas conversas ÷ conversas atribuídas a essas campanhas. Conversas sem campanha não recebem custo inventado. Sem denominador, aparece “—”.
- **Conversão de conversa:** conversas iniciadas no período com pedido atualmente aprovado até o fim do período ÷ conversas iniciadas no período. Reembolso deixa de contar como compra aprovada.
- **Pedidos e receita vinculada:** seguem a data original do pedido, mesmo se a conversa for anterior. Já integram os relatórios de vendas; não devem ser somados novamente ao faturamento.
- O modelo de colunas **Conversas e vendas** adiciona 11 métricas de WhatsApp nas campanhas, conjuntos e anúncios. As métricas de coorte consideram conversas iniciadas no período; receita/vendas da coorte também exigem pedido no período. Etapas refletem o estado atual, não um retrato histórico.

## Dados e segurança

O webhook verifica HMAC SHA-256 dos bytes recebidos, WABA e Phone Number ID. O painel e as operações de configuração exigem sessão administrativa. São armazenados nome, telefone, etapa, horários, identificadores, tipo/direção de mensagem, referência de origem e vínculo de pedido. Corpos de mensagens e mídias não são persistidos nem exibidos: o texto é examinado temporariamente apenas para localizar a referência de atribuição.

Referências: [coexistência — 360dialog](https://docs.360dialog.com/docs/resources/phone-numbers/coexistence), [callback por número — Meta](https://developers.facebook.com/docs/whatsapp/embedded-signup/webhooks/override#set-phone-number-alternate-callback), [implementação de referência do callback — PyWa](https://github.com/david-lev/pywa/blob/master/pywa/api.py).
