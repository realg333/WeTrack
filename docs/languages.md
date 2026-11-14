# Idiomas da interface

O seletor global oferece pt-BR, en, es, fr, de, zh-CN, ja, hi e ar. A escolha fica no navegador e pode ser compartilhada com `?lang=en`. A troca recarrega a página, preservando caminho, hash e outros parâmetros. Não altere o idioma com formulários ainda não salvos.

As traduções são catálogos estáticos carregados por idioma. Nenhum dado de conta, campanha ou cliente é enviado para tradução durante o uso. Valores monetários mantêm a moeda original e usam a formatação do idioma; os relatórios mantêm o fuso de Brasília. Os textos originais ficam como fallback.

O plugin `scripts/localization.mjs` localiza textos literais da interface durante o build, incluindo atributos acessíveis e modelos com placeholders. Ele não traduz respostas de dados nem percorre o DOM; os nomes informados pelos usuários ficam preservados. Mensagens do servidor sem entrada correspondente no catálogo continuam no idioma original. As páginas legais têm versões estáticas em `/legal/{idioma}/` e mantêm a versão original em português.

Os catálogos iniciais foram gerados por tradução automática, com ajustes de terminologia no inglês. Não são traduções certificadas nem passaram por revisão integral de falantes nativos. Antes de campanhas internacionais, revise o texto comercial e jurídico com profissionais dos mercados de destino.

Para manter: `node scripts/localization.mjs --extract`, atualize as entradas faltantes nos JSONs e execute `node scripts/check-locales.mjs`, `npm run build` e os testes de idiomas no Playwright. Não adicione dados privados aos catálogos. A geração inicial não é uma dependência de produção.
