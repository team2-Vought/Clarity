"""Текст PDF в окремому процесі з обмеженням часу.

pypdf розбирає файл у Python, і зловмисно складений PDF (вкладені потоки,
величезні сторінки) займає процесор на хвилини. У самому запиті це блокувало
б вебсервер, тож розбір іде в дочірньому процесі: не встиг за
ATTACHMENTS_PDF_TIMEOUT_SECONDS — процес убито, людина бачить помилку.

Модуль навмисно не імпортує Django: дочірній процес стартує «з нуля» (spawn)
і завантажує лише його та pypdf.
"""

import io
import multiprocessing

ENCRYPTED = 'encrypted'
BROKEN = 'broken'
TIMEOUT = 'timeout'


def _extract(data, max_pages, conn):
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            conn.send((ENCRYPTED, None))
            return
        pages = []
        for index, page in enumerate(reader.pages):
            if index >= max_pages:
                break
            pages.append(page.extract_text() or '')
        conn.send((None, pages))
    except Exception as exc:
        # пошкоджені PDF падають у pypdf різними помилками — для людини це одне й те саме
        conn.send((BROKEN, repr(exc)[:300]))
    finally:
        conn.close()


def extract_pages(data, *, timeout, max_pages):
    """(error, pages): error — None, ENCRYPTED, BROKEN або TIMEOUT."""
    context = multiprocessing.get_context('spawn')
    parent, child = context.Pipe(duplex=False)
    process = context.Process(target=_extract, args=(data, max_pages, child), daemon=True)
    process.start()
    child.close()
    try:
        if not parent.poll(timeout):
            return TIMEOUT, None
        try:
            return parent.recv()
        except EOFError:
            # процес упав, нічого не надіславши (наприклад, забракло пам'яті)
            return BROKEN, None
    finally:
        parent.close()
        if process.is_alive():
            process.kill()
        process.join(1)
