from django.urls import path

from .views import (
    DiscussionAdvanceView,
    DiscussionDetailView,
    DiscussionListCreateView,
    DiscussionMessageView,
    DiscussionRunView,
    DiscussionStopView,
    FreeModelListView,
    PersonaListView,
)

app_name = 'discussions'

urlpatterns = [
    path('personas/', PersonaListView.as_view(), name='personas'),
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
    path('discussions/<uuid:pk>/stop/', DiscussionStopView.as_view(), name='discussion-stop'),
    path(
        'discussions/<uuid:pk>/messages/',
        DiscussionMessageView.as_view(),
        name='discussion-messages',
    ),
]
