import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AuthPage } from './AuthLayout';
import LoginForm from '../components/LoginForm';
import GoogleButton from '../components/GoogleButton';
import { login } from '../api/auth';
import { copy } from '../copy';
import { getSession, isGuestSession } from '../api/client';
import { useToasts } from '../hooks/useToasts';

export default function LoginPage() {
  const navigate = useNavigate();
  const { pushToast } = useToasts();
  // гість входить у свій акаунт — його дискусія перейде туди, тож форму показуємо
  // (позначку беремо один раз: після входу вона зникає, а редирект не має перебити перехід)
  const [guest] = useState(isGuestSession);
  // уже в акаунті — форма входу не потрібна, одразу в застосунок
  // (позначка застаріла — застосунок отримає 401, зітре її й поверне сюди)
  if (getSession() && !guest) return <Navigate to="/home" replace />;
  return (
    <AuthPage
      title={copy.login.title}
      variant="login"
      form={
        <LoginForm
          onSubmit={async (data) => {
            const signed = await login(data);
            if (signed?.adopted_discussions) {
              pushToast(copy.guest.adopted, 'success');
              navigate('/history');
            } else {
              navigate('/home');
            }
          }}
          onSwitch={() => navigate('/register')}
          onForgot={() => navigate('/forgot-password')}
          alternative={<GoogleButton onSignedIn={() => navigate('/home')} />}
        />
      }
    />
  );
}
