from django.urls import path

from .account_settings import ProviderKeyView, SettingsView
from .views import (
    DiscussionAdvanceView,
    DiscussionClarifyView,
    DiscussionDetailView,
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
    path('shared/<uuid:token>/', SharedDiscussionView.as_view(), name='shared-discussion'),
    path('teams/', TeamListCreateView.as_view(), name='team-list'),
    path('teams/<uuid:pk>/', TeamDetailView.as_view(), name='team-detail'),
]
