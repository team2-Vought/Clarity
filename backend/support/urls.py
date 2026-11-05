from django.urls import path

from .views import BugReportView

app_name = 'support'

urlpatterns = [
    path('reports/', BugReportView.as_view(), name='bug-report'),
]
