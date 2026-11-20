// Під час деплою сторінка може взяти index.html однієї версії, а файли
// з /assets/ — іншої: якийсь не завантажиться, і замість застосунку буде
// порожній екран. Тоді один раз перезавантажуємо сторінку — нова версія
// вже на місці. Не частіше ніж раз на 30 с, щоб не зациклитися.
//
// Браузер міг закешувати саму помилку (так буває в Safari), і звичайне
// перезавантаження знову взяло б її з кешу. Тому спершу заново
// запитуємо ці файли повз кеш — свіжа відповідь заміняє збережену.
(function () {
  var KEY = 'clarity:asset-reload';
  var failed = [];
  var scheduled = false;

  function allowed() {
    try {
      var last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last < 30000) return false;
      sessionStorage.setItem(KEY, String(Date.now()));
      return true;
    } catch {
      // без sessionStorage не можемо захиститися від циклу — краще не чіпати
      return false;
    }
  }

  function refresh(url) {
    if (!window.fetch) return Promise.resolve();
    return fetch(url, { cache: 'reload', credentials: 'same-origin' }).catch(function () {});
  }

  function reloadOnce(url) {
    if (url && failed.indexOf(url) === -1) failed.push(url);
    if (scheduled) return;
    scheduled = true;
    // коротка пауза: встигають прийти інші помилки й завершитися перемикання версій
    setTimeout(function () {
      if (!allowed()) return;
      var timeout = new Promise(function (resolve) {
        setTimeout(resolve, 3000);
      });
      Promise.race([Promise.all(failed.map(refresh)), timeout]).then(function () {
        window.location.reload();
      });
    }, 800);
  }

  // скрипти й стилі, що не завантажилися (помилки ресурсів не спливають — ловимо на захопленні)
  window.addEventListener(
    'error',
    function (event) {
      var el = event.target;
      if (!el || (el.tagName !== 'SCRIPT' && el.tagName !== 'LINK')) return;
      var url = el.src || el.href || '';
      if (url.indexOf('/assets/') !== -1) reloadOnce(url);
    },
    true
  );

  // ліниві частини (import()) — Vite повідомляє про них окремою подією
  window.addEventListener('vite:preloadError', function (event) {
    event.preventDefault();
    var match = /(https?:\/\/[^\s'"]+\/assets\/[^\s'"]+)/.exec(String(event.payload && event.payload.message));
    reloadOnce(match ? match[1] : '');
  });
})();
