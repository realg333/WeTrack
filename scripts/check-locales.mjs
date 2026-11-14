import fs from 'node:fs';
const source = JSON.parse(fs.readFileSync('src/locales/source.json', 'utf8'));
for (const lang of ['en', 'es', 'fr', 'de', 'zh-CN', 'ja', 'hi', 'ar']) {
  const dict = JSON.parse(fs.readFileSync(`src/locales/${lang}.json`, 'utf8'));
  const missing = source.filter((k) => !dict[k]);
  const bad = source.filter((k) =>
    (k.match(/\{\d+\}/g) || []).some(
      (p) => !dict[k]?.replace(/\{\s*(\d+)\s*\}/g, '{$1}').includes(p),
    ),
  );
  if (missing.length || bad.length) {
    console.error(lang, { missing, bad });
    process.exitCode = 1;
  } else console.log(`${lang}: ${source.length} messages, placeholders preserved`);
}
