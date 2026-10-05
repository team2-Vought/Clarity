import { useNavigate } from 'react-router-dom';
import { AuthPage } from './AuthLayout';
import LoginForm from '../components/LoginForm';
import { login } from '../api/auth';
import { uk } from '../copy/uk';

export default function LoginPage() {
  const navigate = useNavigate();
  return (
    <AuthPage
      title={uk.login.title}
      variant="login"
      form={<LoginForm onSubmit={(data) => login(data)} onSwitch={() => navigate('/register')} />}
    />
  );
}
