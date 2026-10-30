"""Промпти для фаз дискусії.

Кожен промпт містить повний контекст: опис проблеми, контекст від користувача,
режим, учасників, знайдені в інтернеті джерела, характер мовця та історію
дискусії разом з уточненнями користувача.

Промпти поділено за призначенням: `rules_uk` / `rules_en` — незмінні правила
для моделей, `systems` — системні промпти, `context` — контекст дискусії,
`profile` — профіль «Про мене», `documents` — вкладення, `debate` — промпти
учасників, `judges` — промпти суддів, `clarify` — перевірка контексту перед
стартом. Решта коду користується іменами нижче.
"""

from .rules_uk import (
    DATA_TAGS,
    REASONING_RULES,
    SAFETY_RULE,
    FORMAT_RULES,
    SYSTEM_BASE,
    CHARACTER_DIRECTIVES,
    CHARACTER_LIMITS,
    JSON_TEXT_RULE,
    DEVIL_SYSTEM,
    MODERATOR_SYSTEM,
    STATUS_SYSTEM,
)
from .rules_en import (
    DATA_TAGS_EN,
    REASONING_RULES_EN,
    SAFETY_RULE_EN,
    FORMAT_RULES_EN,
    SYSTEM_BASE_EN,
    CHARACTER_DIRECTIVES_EN,
    CHARACTER_LIMITS_EN,
    JSON_TEXT_RULE_EN,
    DEVIL_SYSTEM_EN,
    MODERATOR_SYSTEM_EN,
    STATUS_SYSTEM_EN,
)
from .common import (
    mode_block,
    THESIS_LIMIT,
    fallback_thesis,
    ROLE_LABELS,
    ROLE_LABELS_EN,
    STANCE_LABELS_EN,
    stance_label,
)
from .systems import (
    safety_rule,
    devil_system,
    moderator_system,
    status_system,
    status_prompt,
    persona_system,
)
from .context import (
    REPLY_LENGTH,
    length_rule,
    service_lines_block,
    SOURCE_SNIPPET_LIMIT,
    sources_block,
)
from .profile import (
    profile_block,
)
from .documents import (
    documents_block,
)
from .debate import (
    opening_prompt,
    debate_prompt,
    rebuttal_prompt,
)
from .judges import (
    SOURCES_RULE,
    SOURCES_RULE_EN,
    USER_NOTES_RULE,
    USER_NOTES_RULE_EN,
    synthesis_prompt,
    devil_prompt,
    final_prompt,
)
from .clarify import (
    CLARIFY_MAX_QUESTIONS,
    CLARIFY_MAX_OPTIONS,
    CLARIFY_SYSTEM,
    CLARIFY_SYSTEM_EN,
    clarify_system,
    clarify_prompt,
    question_with_clarifications,
)

__all__ = [
    'profile_block',
    'documents_block',
    'DATA_TAGS',
    'REASONING_RULES',
    'SAFETY_RULE',
    'FORMAT_RULES',
    'SYSTEM_BASE',
    'CHARACTER_DIRECTIVES',
    'CHARACTER_LIMITS',
    'JSON_TEXT_RULE',
    'DEVIL_SYSTEM',
    'MODERATOR_SYSTEM',
    'STATUS_SYSTEM',
    'DATA_TAGS_EN',
    'REASONING_RULES_EN',
    'SAFETY_RULE_EN',
    'FORMAT_RULES_EN',
    'SYSTEM_BASE_EN',
    'CHARACTER_DIRECTIVES_EN',
    'CHARACTER_LIMITS_EN',
    'JSON_TEXT_RULE_EN',
    'DEVIL_SYSTEM_EN',
    'MODERATOR_SYSTEM_EN',
    'STATUS_SYSTEM_EN',
    'mode_block',
    'THESIS_LIMIT',
    'fallback_thesis',
    'ROLE_LABELS',
    'ROLE_LABELS_EN',
    'STANCE_LABELS_EN',
    'stance_label',
    'safety_rule',
    'devil_system',
    'moderator_system',
    'status_system',
    'status_prompt',
    'persona_system',
    'REPLY_LENGTH',
    'length_rule',
    'service_lines_block',
    'SOURCE_SNIPPET_LIMIT',
    'sources_block',
    'opening_prompt',
    'debate_prompt',
    'rebuttal_prompt',
    'SOURCES_RULE',
    'SOURCES_RULE_EN',
    'USER_NOTES_RULE',
    'USER_NOTES_RULE_EN',
    'synthesis_prompt',
    'devil_prompt',
    'final_prompt',
    'CLARIFY_MAX_QUESTIONS',
    'CLARIFY_MAX_OPTIONS',
    'CLARIFY_SYSTEM',
    'CLARIFY_SYSTEM_EN',
    'clarify_system',
    'clarify_prompt',
    'question_with_clarifications',
]
