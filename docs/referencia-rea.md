# Análise de referência com REA

Observação em 17/10/2026. Referências: LowTrack, UTMify e cinco capturas de integrações fornecidas pelo usuário.

O REA observou a página pública `https://lowtrack.com.br` e a tela de login em cenários controlados no Chromium. A página descreve atribuição, Meta, pixel, deduplicação, webhooks, dashboards e regras. O login oferece e-mail/senha, Google e Apple. Não havia sessão autenticada disponível para observar o dashboard.

- Página pública: `ev_e79f5f1776ebd579c4418ddc410a1770cff24e1af65fb9854f10ad2097d95d2b`.
- Login: `ev_d5051f044f686f7d3b2595b83c1df466cf64ce1c57f8ccbdc43a95b3b3cc54a1`.
- Aplicação local: `ev_7fdd4e152b9d0d43be21ba380a29c5327a1900b7e3f30fa21bd5110d32962756`, sem erros de página na janela observada.

Esses IDs referenciam respostas das ferramentas nesta conversa, não arquivos de código ou provas de equivalência. A captura local ocorreu durante a implementação e não substitui os testes finais.

| Referência                    | WeTrack                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Navegação escura por operação | Shell próprio, seletor, temas e navegação responsiva                          |
| Contas de anúncios            | Token Meta, contas BRL e sincronização manual de insights                     |
| Modal Facebook                | Token oficial; OAuth ainda pendente                                           |
| Pixels e instalação           | Domínio, script, eventos e CAPI opcional                                      |
| Tokens webhook                | Hash, URL exibida uma vez, deduplicação e revogação                           |
| Catálogo de plataformas       | API personalizada funcional; adaptadores nativos identificados como pendentes |

O dashboard foi projetado para a WeTrack com marca, componentes e hierarquia próprios. Não foram inferidos endpoints privados, regras internas, fórmulas proprietárias ou dados reais de terceiros. Materiais comerciais não demonstram implementação: promessas de nota do pixel, certificação Meta e qualidade de correspondência não foram adotadas.

Não foram fornecidas credenciais Meta nem payloads reais nativos de checkout. Os conectores externos foram testados com transporte simulado. Diferenças e limites estão no README.
