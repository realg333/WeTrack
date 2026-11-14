(function () {
  var supported = ['en', 'es', 'fr', 'de', 'zh-CN', 'ja', 'hi', 'ar'];
  var match = location.pathname.match(/^\/legal\/([^/]+)\//);
  var lang = match ? match[1] : new URLSearchParams(location.search).get('lang');
  try {
    lang = lang || localStorage.getItem('wt_language');
  } catch (e) {}
  if (!match && supported.includes(lang))
    location.replace('/legal/' + lang + '/' + location.pathname.split('/').pop());
  document.addEventListener('DOMContentLoaded', function () {
    var select = document.createElement('select');
    select.setAttribute('aria-label', 'Language / Idioma');
    var names = [
      'Português',
      'English',
      'Español',
      'Français',
      'Deutsch',
      '中文',
      '日本語',
      'हिन्दी',
      'العربية',
    ];
    ['pt-BR'].concat(supported).forEach(function (code, i) {
      var o = new Option(names[i], code);
      o.selected = code === (lang || 'pt-BR');
      select.add(o);
    });
    select.style.cssText =
      'position:fixed;bottom:12px;right:12px;padding:10px;z-index:100;background:#172126;color:white;border-radius:8px';
    select.onchange = function () {
      try {
        localStorage.setItem('wt_language', select.value);
      } catch (e) {}
      location.href =
        (select.value === 'pt-BR' ? '/' : '/legal/' + select.value + '/') +
        location.pathname.split('/').pop() +
        '?lang=' +
        select.value;
    };
    document.body.appendChild(select);
  });
})();
