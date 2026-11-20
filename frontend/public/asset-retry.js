// Під час деплою сторінка може взяти index.html однієї версії, а файли
// з /assets/ — іншої: якийсь не завантажиться, і замість застосунку буде
// порожній екран. Тоді один раз перезавантажуємо сторінку — нова версія
// вже на місці. Не частіше ніж раз на 30 с, щоб не зациклитися.
(function () {
  var KEY = 'clarity:asset-reload';

  function reloadOnce() {
    try {
      var last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last < 30000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      // без sessionStorage не можемо захиститися від циклу — краще не чіпати
      return;
    }
    // коротка пауза: перемикання на нову версію встигає завершитися
    setTimeout(function () {
      window.location.reload();
    }, 800);
  }

  // скрипти й стилі, що не завантажилися (помилки ресурсів не спливають — ловимо на захопленні)
  window.addEventListener(
    'error',
    function (event) {
      var el = event.target;
      if (!el || (el.tagName !== 'SCRIPT' && el.tagName !== 'LINK')) return;
      var url = el.src || el.href || '';
      if (url.indexOf('/assets/') !== -1) reloadOnce();
    },
    true
  );

  // ліниві частини (import()) — Vite повідомляє про них окремою подією
  window.addEventListener('vite:preloadError', function (event) {
    event.preventDefault();
    reloadOnce();
  });
})();
