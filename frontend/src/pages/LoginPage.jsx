import { Navigate, useNavigate } from 'react-router-dom';
import { AuthPage } from './AuthLayout';
import LoginForm from '../components/LoginForm';
import GoogleButton from '../components/GoogleButton';
import { login } from '../api/auth';
import { copy } from '../copy';
import { getSession } from '../api/client';

export default function LoginPage() {
  const navigate = useNavigate();
  // уже в акаунті — форма входу не потрібна, одразу в застосунок
  // (позначка застаріла — застосунок отримає 401, зітре її й поверне сюди)
  if (getSession()) return <Navigate to="/home" replace />;
  return (
    <AuthPage
      title={copy.login.title}
      variant="login"
      form={
        <LoginForm
          onSubmit={async (data) => {
            await login(data);
            navigate('/home');
          }}
          onSwitch={() => navigate('/register')}
          onForgot={() => navigate('/forgot-password')}
          alternative={<GoogleButton onSignedIn={() => navigate('/home')} />}
        />
      }
    />
  );
}
