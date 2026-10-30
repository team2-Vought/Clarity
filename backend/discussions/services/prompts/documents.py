"""Документи, які людина додала до питання: оффер, договір, резюме, оголошення."""

from backend.i18n import L

from .common import _inline


def documents_block(documents):
    """Блок <user_documents> з правилом, як на них спиратися; '' — документів немає.

    `documents` — [(назва, текст)], уже обрізані до бюджету промпту."""
    if not documents:
        return ''
    lines = [
        L(
            'Документи, які людина додала до питання:',
            'Documents the person attached to the question:',
        ),
        '<user_documents>',
    ]
    for name, text in documents:
        lines.extend([f'<document name="{_inline(name)}">', text, '</document>'])
    lines.extend(
        [
            '</user_documents>',
            L(
                'Спирайся на документи: цифри, умови, дати й формулювання бери звідти, а не '
                'з припущень. Якщо в документі є важливе, чого людина не згадала (пастка в '
                'договорі, умова оффера, розбіжність із її словами), — скажи про це. Цитуй '
                'коротко, з назвою документа. Позначка […] означає, що текст обрізано.',
                'Rely on the documents: take numbers, terms, dates and wording from them rather '
                'than from assumptions. If a document contains something important the person '
                'did not mention (a trap in a contract, a term of an offer, a mismatch with '
                'what they said), point it out. Quote briefly, naming the document. The […] '
                'mark means the text was cut.',
            ),
        ]
    )
    return '\n'.join(lines)
