# Acesso avançado Meta — WeTrack

Preparação em 18/10/2026. A concessão de acesso deve ser conferida no painel Meta; este documento não confirma aprovação de permissões.

## Aplicativo e endereços

- Aplicativo: `1442383051423460` — WeTrack.
- Configuração do Login para Empresas: `1651249129908668`.
- Site: https://wetrack-psi.vercel.app/
- Retorno OAuth: https://wetrack-psi.vercel.app/api/meta/oauth/callback
- Privacidade: https://wetrack-psi.vercel.app/privacy.html
- Instruções de exclusão: https://wetrack-psi.vercel.app/data-deletion.html
- Termos: https://wetrack-psi.vercel.app/terms.html
- Contato público autorizado: icloud.giancotti@gmail.com.

Publicação do app, verificação empresarial e aprovação de cada permissão são verificações distintas. A confirmação de publicação e verificação foi informada pelo responsável pelo aplicativo. O nível de acesso de cada permissão ainda precisa ser observado no painel.

## Permissões a conferir

| Permissão        | Finalidade                                                                                                 | Estado da implementação                                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public_profile` | Requisito do Facebook Login para Empresas para autorizar usuários externos ao aplicativo                   | Conferir acesso avançado concedido. A WeTrack não consulta o perfil pessoal separadamente nem publica em nome do usuário.                                                                                                                                   |
| `ads_read`       | Consultar contas acessíveis e importar campanhas, conjuntos, anúncios e resultados das contas selecionadas | Implementada. O responsável informou que o OAuth funciona no perfil principal; o registro das chamadas de teste na Meta está pendente.                                                                                                                      |
| `ads_management` | Alterar nome e status de campanhas, conjuntos e anúncios, e orçamento no nível que o controla              | Implementada com confirmação explícita da conta, consulta antes e depois da escrita, validação de orçamento e detecção de alteração concorrente. Testes automatizados usam transporte simulado; a demonstração real para análise ainda precisa ser gravada. |

“Disponível”, inclusão na configuração de login ou aprovação de um caso de uso não devem ser usados como evidência do nível concedido a uma permissão específica. Registrar o texto de nível e estado que aparece para cada item.

## Texto para explicar o uso de ads_read

> A WeTrack centraliza resultados de mídia e atribuição de conversões. Após autorizar o aplicativo pelo Facebook Login para Empresas, o usuário visualiza as contas de anúncios às quais tem acesso e seleciona quais deseja incluir na operação. Usamos ads_read para consultar campanhas, conjuntos, anúncios e métricas dessas contas, exibindo investimento e desempenho no painel e no funil. As contas importadas começam desativadas e são incluídas pelo usuário. O usuário pode desconectar a integração. O histórico já importado e as instruções de exclusão são descritos na política de privacidade.

No formulário de `ads_read`, selecionar a opção sobre dados de desempenho de anúncios em painéis personalizados e análise de dados. O envio de eventos CAPI é outro fluxo e não é a justificativa dessa leitura.

## Texto para explicar o uso de ads_management

> A WeTrack permite que o usuário gerencie anúncios a partir dos resultados da sua operação. Após o Facebook Login para Empresas, ele seleciona as contas de anúncios que deseja incluir. Nas contas selecionadas em BRL, o usuário pode editar o nome e ativar ou pausar campanhas, conjuntos e anúncios, além de ajustar o orçamento diário ou total no nível que já controla esse orçamento. Antes de enviar uma alteração à Marketing API, exibimos a conta, o item e os valores atuais, e exigimos confirmação explícita. Consultamos novamente a Meta para confirmar o resultado. Essa permissão é necessária para executar as alterações solicitadas pelo próprio usuário; ads_read permite consultar os dados, mas não autoriza essas operações de gestão. O usuário pode desativar contas na WeTrack ou desconectar a integração.

Não incluir criação, duplicação, alteração de criativos ou automações de orçamento na demonstração: essas funções ainda não estão implementadas.

## Registro das chamadas de teste

Em 18/10/2026, o responsável informou que já realizou os testes de `ads_read` e `ads_management`, há menos de 24 horas, em outra conversa. As respostas desses testes não foram verificadas neste repositório. O aplicativo ainda não foi enviado para análise.

A tela do formulário informa até 24 horas para o contador atualizar; o guia oficial de envio admite até 2 dias. A Meta exige ao menos uma chamada bem-sucedida usando cada permissão solicitada, nos 30 dias anteriores ao envio. Os testes locais com transporte simulado da WeTrack não contam para esse requisito.

Enquanto o registro estiver nesse prazo, salvar o rascunho e aguardar. Não repetir alterações reais em campanhas para tentar acelerar o contador. Se continuar zerado depois de 48 horas, conferir:

1. Se o aplicativo selecionado ao gerar o token era WeTrack, ID `1442383051423460`, e se o token foi emitido para esse mesmo aplicativo. Um token gerado por outro app não comprova o teste da WeTrack.
2. Se a resposta da chamada foi bem-sucedida, sem objeto `error`, e se o endpoint de cada teste exercita a permissão solicitada. A presença de duas permissões no token, sozinha, não demonstra que as duas foram utilizadas.
3. O horário, endpoint, status HTTP e resposta sem tokens dos testes já feitos, para comparar com o item exigido no painel de testes da Meta.

Se essas condições estiverem atendidas e o atraso persistir, encaminhar os dados sanitizados ao suporte da Meta. Não regenerar o segredo do aplicativo ou alterar o callback como tentativa de corrigir um contador atrasado.

## Demonstração para a análise

Gravar o comportamento real, depois que o login estiver funcionando para o responsável pelo app. Usar uma conta de anúncios autorizada para avaliação.

1. Abrir a WeTrack e selecionar a operação destinada à avaliação.
2. Entrar em Integrações → Meta Ads e gerar o link de conexão.
3. Mostrar a autorização no Facebook, as permissões solicitadas e os ativos autorizados.
4. Concluir o retorno à WeTrack e atualizar a lista de contas.
5. Selecionar uma conta e sincronizar os resultados.
6. Mostrar campanhas, conjuntos, anúncios e indicadores recebidos da Meta.
7. Abrir **Editar na Meta** em um item da conta destinada à avaliação, mostrar o nome da conta e seus valores atuais.
8. Demonstrar uma alteração autorizada de nome ou status e um ajuste de orçamento, quando esse item possuir orçamento próprio. Confirmar a operação e mostrar o valor retornado pela Meta, inclusive no Gerenciador de Anúncios. Usar itens de avaliação adequados e evitar ativar veiculação por engano.
9. Mostrar a desconexão e o endereço público com instruções de exclusão.

As credenciais de avaliação e os dados necessários à demonstração devem ser fornecidos somente nos campos privados da análise Meta. Não colocar senhas, tokens, chaves secretas ou dados de clientes neste documento, em vídeos públicos ou no GitHub. O acesso de avaliação deve usar dados e contas próprios para essa finalidade.

## Acesso de outro perfil

O responsável informou que o navegador principal conecta, enquanto o Multilogin usa outro perfil, do sócio, e apresenta “Recurso indisponível”. Isso não isola um defeito do navegador: as permissões ainda não foram enviadas para análise. A liberação para usuários externos depende do nível de acesso aprovado, incluindo o requisito de `public_profile` do Login para Empresas. Não considerar o sucesso do administrador como validação do acesso externo.

Cada tentativa deve começar com um novo link WeTrack, usado e concluído dentro do mesmo perfil de navegador. O link é de uso único. O endereço de callback já foi validado no painel Meta.

## Se as permissões já estiverem aprovadas

Não criar uma solicitação duplicada. Conferir avisos e restrições do aplicativo, o tipo de token da configuração de Login para Empresas e os requisitos específicos apontados pelo painel. A mensagem “Recurso indisponível” não identifica sozinha a causa. App ID, Config ID e callback enviados pela WeTrack já foram conferidos.

## Fontes oficiais consultadas

- [Facebook Login for Business](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business): requisito de acesso avançado de public_profile para usuários externos, configurações e tipos de token.
- [Meta App Review](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review): escopo da análise e necessidade de acesso e demonstração das funcionalidades solicitadas.
- [Guia oficial de envio](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review/submission-guide): chamadas por permissão, prazo de até 2 dias para registro e gravação de demonstração.
