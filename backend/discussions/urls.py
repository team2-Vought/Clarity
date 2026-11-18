from django.urls import path

from .account_settings import ProviderKeyView, SettingsView
from .attachment_views import AttachmentDetailView, AttachmentUploadView
from .tts import SpeechView
from .journal import (
    JournalDetailView,
    JournalDueView,
    JournalListView,
    JournalStatsView,
    JournalUnsubscribeView,
)
from .views import (
    DiscussionAdvanceView,
    DiscussionClarifyView,
    DiscussionDetailView,
    CustomPersonaDetailView,
    CustomPersonaListView,
    DiscussionFeedbackView,
    DiscussionFinishView,
    DiscussionListCreateView,
    DiscussionMessageView,
    DiscussionNotCrisisView,
    DiscussionRunView,
    DiscussionShareView,
    DiscussionStopView,
    DiscussionSwapModelView,
    DiscussionTreeView,
    FreeModelListView,
    HighlightDetailView,
    MessageHighlightListView,
    MessageReactionView,
    PersonaListView,
    SharedDiscussionView,
    TeamDetailView,
    TeamListCreateView,
)

app_name = 'discussions'

urlpatterns = [
    path('personas/', PersonaListView.as_view(), name='personas'),
    path('personas/custom/', CustomPersonaListView.as_view(), name='custom-personas'),
    path('personas/custom/<uuid:pk>/', CustomPersonaDetailView.as_view(), name='custom-persona'),
    path('settings/', SettingsView.as_view(), name='settings'),
    path('settings/keys/<str:provider>/', ProviderKeyView.as_view(), name='settings-key'),
    path('models/', FreeModelListView.as_view(), name='models'),
    path('tts/', SpeechView.as_view(), name='tts'),
    path('discussions/', DiscussionListCreateView.as_view(), name='discussion-list'),
    path(
        'discussions/<uuid:pk>/',
        DiscussionDetailView.as_view(),
        name='discussion-detail',
    ),
    path(
        'discussions/<uuid:pk>/advance/',
        DiscussionAdvanceView.as_view(),
        name='discussion-advance',
    ),
    path('discussions/<uuid:pk>/run/', DiscussionRunView.as_view(), name='discussion-run'),
    path(
        'discussions/<uuid:pk>/clarify/',
        DiscussionClarifyView.as_view(),
        name='discussion-clarify',
    ),
    path('discussions/<uuid:pk>/stop/', DiscussionStopView.as_view(), name='discussion-stop'),
    path(
        'discussions/<uuid:pk>/swap-model/',
        DiscussionSwapModelView.as_view(),
        name='discussion-swap-model',
    ),
    path(
        'discussions/<uuid:pk>/not-crisis/',
        DiscussionNotCrisisView.as_view(),
        name='discussion-not-crisis',
    ),
    path(
        'discussions/<uuid:pk>/finish/',
        DiscussionFinishView.as_view(),
        name='discussion-finish',
    ),
    path(
        'discussions/<uuid:pk>/messages/',
        DiscussionMessageView.as_view(),
        name='discussion-messages',
    ),
    path('discussions/<uuid:pk>/tree/', DiscussionTreeView.as_view(), name='discussion-tree'),
    path('discussions/<uuid:pk>/share/', DiscussionShareView.as_view(), name='discussion-share'),
    path(
        'discussions/<uuid:pk>/feedback/',
        DiscussionFeedbackView.as_view(),
        name='discussion-feedback',
    ),
    path(
        'discussions/<uuid:pk>/messages/<uuid:message_pk>/reaction/',
        MessageReactionView.as_view(),
        name='message-reaction',
    ),
    path(
        'discussions/<uuid:pk>/messages/<uuid:message_pk>/highlights/',
        MessageHighlightListView.as_view(),
        name='message-highlights',
    ),
    path(
        'discussions/<uuid:pk>/highlights/<uuid:highlight_pk>/',
        HighlightDetailView.as_view(),
        name='highlight-detail',
    ),
    path('shared/<uuid:token>/', SharedDiscussionView.as_view(), name='shared-discussion'),
    path('attachments/', AttachmentUploadView.as_view(), name='attachments'),
    path('attachments/<uuid:pk>/', AttachmentDetailView.as_view(), name='attachment-detail'),
    path('journal/', JournalListView.as_view(), name='journal'),
    path('journal/due/', JournalDueView.as_view(), name='journal-due'),
    path('journal/stats/', JournalStatsView.as_view(), name='journal-stats'),
    path(
        'journal/unsubscribe/<str:token>/',
        JournalUnsubscribeView.as_view(),
        name='journal-unsubscribe',
    ),
    path('journal/<uuid:pk>/', JournalDetailView.as_view(), name='journal-detail'),
    path('teams/', TeamListCreateView.as_view(), name='team-list'),
    path('teams/<uuid:pk>/', TeamDetailView.as_view(), name='team-detail'),
]
