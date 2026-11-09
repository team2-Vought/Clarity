import { Navigate, useNavigate } from 'react-router-dom';
import { AuthPage } from './AuthLayout';
import RegisterForm, { TermsLinks } from '../components/RegisterForm';
import GoogleButton from '../components/GoogleButton';
import { login, register } from '../api/auth';
import { copy } from '../copy';
import { getSession } from '../api/client';

export default function RegisterPage() {
  const navigate = useNavigate();
  // уже в акаунті — форма входу не потрібна, одразу в застосунок
  // (позначка застаріла — застосунок отримає 401, зітре її й поверне сюди)
  if (getSession()) return <Navigate to="/home" replace />;
  return (
    <AuthPage
      title={copy.register.title}
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
          alternative={
            <>
              <GoogleButton onSignedIn={() => navigate('/home')} />
              <p className="form__notice">
                {copy.register.googleNotice}
                <TermsLinks />
              </p>
            </>
          }
        />
      }
    />
  );
}
