import ts from 'typescript';
import fs from 'node:fs';
const extra = new Set(JSON.parse(fs.readFileSync('scripts/interface-copy.json', 'utf8')));
const known = new Set(JSON.parse(fs.readFileSync('src/locales/source.json', 'utf8')));
// Translate source UI copy only. Never walk the DOM or translate account/customer data.
const attrs = new Set([
  'title',
  'placeholder',
  'aria-label',
  'alt',
  'label',
  'subtitle',
  'text',
  'description',
]);
const words =
  /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]|\b(de|da|do|das|dos|para|sua|seu|suas|seus|com|uma|um|por|na|no|mais|ao|ou|em|e|as|os|que|dias|dia|minha|meu|novo|nova|novos|novas|local|sem|todas|todos)\b/i;
const single =
  /^(Nome|Senha|Entrar|Sair|Salvar|Cancelar|Fechar|Voltar|Continuar|Excluir|Remover|Adicionar|Editar|Buscar|Pesquisar|Campanhas|Vendas|Visitas|Receita|Lucro|Custo|Custos|Gasto|Gastos|Investimento|Saldo|Hoje|Ontem|Todas|Todos|Nenhum|Nenhuma|Ativo|Ativa|Inativo|Pausado|Pausada|Pendente|Pendentes|Aprovada|Aprovadas|Reembolsada|Reembolsadas|Cancelada|Canceladas|Direto|Produto|Cliente|Pedido|Valor|Moeda|Origem|Data|Conta|Contas|Conjunto|Conjuntos|Anúncio|Anúncios|Campanha|Campanhas|Atualizar|Atualizando|Carregando|Copiar|Copiado|Conectar|Desconectar|Conectado|Desconectado|Permitir|Selecionar|Aplicar|Limpar|Exportar|Importar|Teste|Testar|Taxas|Resumo|Detalhes|Pagamento|Pagamentos|Limite|Criar|Idioma|Mensal|Anual|Grátis|Sim|Não|Nunca|Sempre|Salvar alterações)$/i;
export function uiCopy(value) {
  return (
    value.length > 1 &&
    !/[{}<>]|https?:|^\/|^\.|^#|^@|SELECT |INSERT |CREATE |UPDATE |DELETE /i.test(value) &&
    (words.test(value) || single.test(value) || extra.has(value) || known.has(value))
  );
}
export function collectAndTransform(code, filename, collect) {
  const source = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edits = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isJsxText(node)) {
      const raw = node.getText(source),
        value = raw.replace(/\s+/g, ' ');
      if (
        value &&
        !/^(code|pre)$/.test(node.parent.openingElement?.tagName?.getText(source) || '') &&
        /[a-zA-ZÀ-ÿ]/.test(value)
      ) {
        collect(value.trim());
        edits.push([node.getStart(source), node.end, `{__wt(${JSON.stringify(value)})}`]);
      }
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      if ((ts.isPropertyAssignment(parent) && parent.name === node) || ts.isLiteralTypeNode(parent))
        return;
      if (ts.isJsxAttribute(parent) && !attrs.has(parent.name.getText(source))) return;
      if (
        uiCopy(node.text) ||
        (node.text.trim() && ts.isJsxAttribute(parent) && attrs.has(parent.name.getText(source)))
      ) {
        collect(node.text);
        const replacement = `__wt(${JSON.stringify(node.text)})`;
        edits.push([
          node.getStart(source),
          node.end,
          ts.isJsxAttribute(parent) ? `{${replacement}}` : replacement,
        ]);
      }
      return;
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      node.templateSpans.forEach((span, i) => (value += `{${i}}` + span.literal.text));
      if (uiCopy(value.replace(/\{\d+\}/g, ''))) {
        collect(value);
        const args = node.templateSpans.map((s) => s.expression.getText(source)).join(',');
        edits.push([node.getStart(source), node.end, `__wt(${JSON.stringify(value)}, [${args}])`]);
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0]))
    code = code.slice(0, start) + value + code.slice(end);
  return edits.length ? `import { t as __wt } from '/src/i18n';\n${code}` : code;
}
export default function localization() {
  return {
    generateBundle() {
      for (const lang of ['en', 'es', 'fr', 'de', 'zh-CN', 'ja', 'hi', 'ar']) {
        const dict = JSON.parse(fs.readFileSync('src/locales/' + lang + '.json', 'utf8'));
        for (const name of ['privacy.html', 'terms.html', 'data-deletion.html']) {
          let html = fs.readFileSync('public/' + name, 'utf8');
          html = html.replace(/>([^<>]+)</g, (all, raw) => {
            const key = raw.replace(/\s+/g, ' ').trim();
            return dict[key] ? '>' + raw.replace(raw.trim(), dict[key]) + '<' : all;
          });
          html = html
            .replace(
              'lang="pt-BR"',
              'lang="' + lang + '" dir="' + (lang === 'ar' ? 'rtl' : 'ltr') + '"',
            )
            .replace(
              /href="\/(privacy|terms|data-deletion)\.html"/g,
              'href="/legal/' + lang + '/$1.html"',
            )
            .replaceAll('href="/"', 'href="/?lang=' + lang + '"');
          this.emitFile({ type: 'asset', fileName: 'legal/' + lang + '/' + name, source: html });
        }
      }
    },
    name: 'wetrack-localization',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]src[\\/].*\.(tsx|ts)$/.test(id) || /[\\/](i18n|LanguagePicker)\./.test(id)) return;
      return { code: collectAndTransform(code, id, () => {}), map: null };
    },
  };
}
if (process.argv.includes('--extract')) {
  const catalog = new Set();
  for (const name of fs.readdirSync('src'))
    if (/\.(tsx|ts)$/.test(name) && !/^(i18n|LanguagePicker)\./.test(name))
      collectAndTransform(fs.readFileSync(`src/${name}`, 'utf8'), name, (s) => catalog.add(s));
  for (const name of ['privacy.html', 'terms.html', 'data-deletion.html']) {
    const html = fs.readFileSync('public/' + name, 'utf8');
    for (const match of html.matchAll(/>([^<>]+)</g)) {
      const value = match[1].replace(/\s+/g, ' ').trim();
      if (value && /[a-zA-ZÀ-ÿ]/.test(value)) catalog.add(value);
    }
  }
  fs.writeFileSync('src/locales/source.json', JSON.stringify([...catalog].sort(), null, 2) + '\n');
  console.log(`${catalog.size} interface messages extracted`);
}
