import { useNavigate } from 'react-router-dom';
import { AuthPage } from './AuthLayout';
import LoginForm from '../components/LoginForm';
import GoogleButton from '../components/GoogleButton';
import { login } from '../api/auth';
import { copy } from '../copy';

export default function LoginPage() {
  const navigate = useNavigate();
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
