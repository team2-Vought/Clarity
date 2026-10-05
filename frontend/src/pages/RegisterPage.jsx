import { useNavigate } from 'react-router-dom';
import { AuthPage } from './AuthLayout';
import RegisterForm from '../components/RegisterForm';
import { register } from '../api/auth';
import { uk } from '../copy/uk';

export default function RegisterPage() {
  const navigate = useNavigate();
  return (
    <AuthPage
      title={uk.register.title}
      variant="register"
      form={<RegisterForm onSubmit={(data) => register(data)} onSwitch={() => navigate('/login')} />}
    />
  );
}
