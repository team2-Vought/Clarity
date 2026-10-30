from django.urls import path

from .account_settings import ProviderKeyView, SettingsView
from .attachment_views import AttachmentDetailView, AttachmentUploadView
from .journal import JournalDetailView, JournalDueView, JournalListView
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
    DiscussionRunView,
    DiscussionShareView,
    DiscussionStopView,
    FreeModelListView,
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
        'discussions/<uuid:pk>/finish/',
        DiscussionFinishView.as_view(),
        name='discussion-finish',
    ),
    path(
        'discussions/<uuid:pk>/messages/',
        DiscussionMessageView.as_view(),
        name='discussion-messages',
    ),
    path('discussions/<uuid:pk>/share/', DiscussionShareView.as_view(), name='discussion-share'),
    path(
        'discussions/<uuid:pk>/feedback/',
        DiscussionFeedbackView.as_view(),
        name='discussion-feedback',
    ),
    path('shared/<uuid:token>/', SharedDiscussionView.as_view(), name='shared-discussion'),
    path('attachments/', AttachmentUploadView.as_view(), name='attachments'),
    path('attachments/<uuid:pk>/', AttachmentDetailView.as_view(), name='attachment-detail'),
    path('journal/', JournalListView.as_view(), name='journal'),
    path('journal/due/', JournalDueView.as_view(), name='journal-due'),
    path('journal/<uuid:pk>/', JournalDetailView.as_view(), name='journal-detail'),
    path('teams/', TeamListCreateView.as_view(), name='team-list'),
    path('teams/<uuid:pk>/', TeamDetailView.as_view(), name='team-detail'),
]
