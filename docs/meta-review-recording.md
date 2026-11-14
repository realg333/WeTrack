# Roteiro de gravação — reenvio à análise da Meta

A rejeição recebida informa que o caso de uso é permitido, mas o vídeo não demonstrou a experiência completa. A interface em inglês é parte da correção; ela sozinha não resolve a análise.

## Antes de gravar

1. Abra https://wetrack-psi.vercel.app/app?lang=en e confirme English no seletor. Configure também Facebook e navegador em inglês.
2. Use uma operação de teste e uma conta de anúncios à qual o perfil tem acesso suficiente. Evite mostrar dados pessoais de clientes.
3. Prepare uma campanha pausada de teste. Para demonstrar alterações reais, prefira renomear essa campanha e restaurar o nome, sem ativar entrega ou aumentar gastos.
4. Grave em 1920×1080, com zoom que permita ler os textos. Mova o cursor devagar e espere os resultados carregarem.
5. Use legendas em inglês, sincronizadas com cada ação. Mostre a autorização da Meta e o resultado dentro da WeTrack. Não substitua esse fluxo por telas de token manual.
6. Garanta que as credenciais e instruções fornecidas no formulário permitam ao avaliador repetir exatamente o fluxo. Não coloque senhas neste roteiro ou em arquivos versionados.

## Vídeo 1 — ads_read (aproximadamente 3 minutos)

| Trecho    | O que gravar                                                                                                                                                   | Legenda sugerida em inglês                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 0:00–0:20 | WeTrack em inglês; abra Integrations e Meta Ads.                                                                                                               | WeTrack helps advertisers view campaign performance and connect advertising costs with sales attribution. |
| 0:20–1:20 | Clique Connect with Facebook, abra a conexão neste navegador, faça o fluxo completo da Meta, selecione os ativos e conceda os acessos. Mostre cada etapa real. | The user connects their own Meta account and grants access to the advertising accounts they manage.       |
| 1:20–1:50 | Retorne à WeTrack, atualize as contas e selecione a conta de teste desta operação.                                                                             | The user selects the ad account to include in this workspace.                                             |
| 1:50–2:40 | Sincronize os dados e abra campanhas, conjuntos e anúncios. Mostre nomes, status e métricas reais retornadas pela Meta. Escolha um período com dados.          | With ads_read, WeTrack reads the selected account's advertising structure and performance metrics.        |
| 2:40–3:00 | Mostre a correspondência com a mesma conta e período no Ads Manager, se necessário.                                                                            | These results come from the connected Meta ad account.                                                    |

Se a Meta apresentar um fluxo diferente por configuração do Business Login, grave o fluxo que realmente aparecer. Não invente telas de consentimento ou afirme que uma permissão foi concedida sem evidência.

## Vídeo 2 — ads_management (aproximadamente 3 minutos)

Repita a conexão e autorização completa, ou inclua esse trecho no início deste vídeo para que ele seja compreensível sozinho.

1. Abra o gerenciamento de campanhas da conta conectada e selecione a campanha pausada de teste.
2. Abra o editor da entidade Meta. Explique o botão e o campo antes de clicar.
3. Altere somente o nome, por exemplo adicionando “Review test”, e salve a alteração na Meta.
4. Espere a confirmação, atualize a lista e mostre o novo nome. Confira a mesma entidade no Ads Manager.
5. Restaure o nome anterior e mostre o resultado persistido.

Legendas sugeridas:

- “With ads_management, the user can edit advertising entities in their connected Meta ad account.”
- “This action updates the campaign in Meta. It is different from enabling a campaign only inside the WeTrack workspace.”
- “After saving, WeTrack refreshes the entity and displays the updated name.”

Não use apenas o botão de ativar/pausar uma campanha local da WeTrack como prova de escrita na Meta. Demonstre uma alteração confirmada pela API na entidade Meta. Se a configuração da conta impedir a escrita, resolva esse acesso antes da gravação.

## pages_show_list e pages_read_engagement — pendência funcional

No código analisado, o OAuth padrão pede ads_read e ads_management. Não foi encontrado um fluxo de produto que liste Páginas do Facebook e leia os dados de engajamento dessas Páginas. Uma configuração externa de Business Login pode conceder outros escopos, mas isso não demonstra uso pelo produto.

Não existe um vídeo honesto do fluxo completo dessas duas permissões com a funcionalidade atual. Se o produto não precisa delas, remova essas solicitações do reenvio. Se precisa, implemente primeiro o caso de uso real de Páginas e então grave:

- pages_show_list: login completo → consentimento correspondente → lista das Páginas administradas retornada pela Meta → seleção de uma Página no produto → resultado útil dessa seleção.
- pages_read_engagement: login completo → consentimento correspondente → Página selecionada → leitura e exibição dos dados permitidos realmente utilizados pelo produto → explicação de como esses dados apoiam o caso de uso descrito.

Não peça permissões adicionais apenas para o vídeo. As observações do envio devem descrever precisamente a funcionalidade demonstrada.

## Observações para o formulário

Descreva em inglês, por permissão, o benefício, os passos reproduzíveis, a conta/ativo de teste e onde o resultado aparece. Use apenas fatos confirmados pela sua gravação.

Modelo para ads_read:

“WeTrack uses ads_read to retrieve the advertising structure and performance metrics of ad accounts selected by the user. Open Integrations → Meta Ads, connect with Facebook, complete authorization, select the test ad account, synchronize it, and open Campaigns to inspect the imported results.”

Modelo para ads_management (ajuste aos botões efetivamente visíveis):

“WeTrack uses ads_management to let an authorized advertiser edit entities in their own connected Meta ad account. After connecting the test account, open the Meta entity editor for the paused test campaign, change its name, save, and refresh. The updated name is persisted in Meta and can be verified in Ads Manager.”

O acesso por token é uma alternativa avançada existente. Se ele for o caso de uso submetido, explique explicitamente se é servidor a servidor ou usa usuário do sistema, conforme a rejeição. Isso não substitui a demonstração do uso efetivo de cada permissão.

## Revisão final

Assista aos vídeos sem áudio: as legendas devem explicar toda a ação. Confira interface em inglês, consentimento completo, resultado real por permissão, correspondência entre vídeo e observações, acesso reproduzível pelo avaliador e ausência de informações privadas desnecessárias.

Referências oficiais consultadas:

- https://developers.facebook.com/docs/app-review/submission-guide/common-mistakes
- https://developers.facebook.com/docs/resp-plat-initiatives/app-review/introduction
