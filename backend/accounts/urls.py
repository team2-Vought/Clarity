from django.urls import path

from .views import (
    AccountExportView,
    SessionDetailView,
    SessionListView,
    EmailConfirmView,
    EmailVerifyResendView,
    EmailVerifyView,
    GoogleLoginView,
    GuestView,
    LoginView,
    LogoutView,
    MeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    PasswordView,
    RegisterView,
)

app_name = 'accounts'

urlpatterns = [
    path('register/', RegisterView.as_view(), name='register'),
    path('login/', LoginView.as_view(), name='login'),
    path('google/', GoogleLoginView.as_view(), name='google'),
    path('guest/', GuestView.as_view(), name='guest'),
    path('logout/', LogoutView.as_view(), name='logout'),
    path('me/', MeView.as_view(), name='me'),
    path('email/confirm/', EmailConfirmView.as_view(), name='email-confirm'),
    path('email/verify/', EmailVerifyView.as_view(), name='email-verify'),
    path('email/verify/resend/', EmailVerifyResendView.as_view(), name='email-verify-resend'),
    path('export/', AccountExportView.as_view(), name='export'),
    path('sessions/', SessionListView.as_view(), name='sessions'),
    path('sessions/<int:pk>/', SessionDetailView.as_view(), name='session'),
    path('password/', PasswordView.as_view(), name='password'),
    path('password-reset/', PasswordResetRequestView.as_view(), name='password-reset'),
    path(
        'password-reset/confirm/',
        PasswordResetConfirmView.as_view(),
        name='password-reset-confirm',
    ),
]
