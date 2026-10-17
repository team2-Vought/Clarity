import { useNavigate } from 'react-router-dom';
import { AuthPage } from './AuthLayout';
import RegisterForm from '../components/RegisterForm';
import { login, register } from '../api/auth';
import { uk } from '../copy/uk';

export default function RegisterPage() {
  const navigate = useNavigate();
  return (
    <AuthPage
      title={uk.register.title}
      variant="register"
      form={
        <RegisterForm
          onSubmit={async (data) => {
            // бекенд не видає токен на реєстрації — одразу логінимось
            await register(data);
            try {
              await login({
                name: data.name,
                email: data.email,
                password: data.password,
              });
              navigate('/home');
            } catch {
              navigate('/login');
            }
          }}
          onSwitch={() => navigate('/login')}
        />
      }
    />
  );
}
