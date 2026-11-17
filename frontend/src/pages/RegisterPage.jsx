import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AuthPage } from './AuthLayout';
import RegisterForm, { TermsLinks } from '../components/RegisterForm';
import GoogleButton from '../components/GoogleButton';
import { login, register } from '../api/auth';
import { copy } from '../copy';
import { getSession, isGuestSession } from '../api/client';
import { useToasts } from '../hooks/useToasts';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { pushToast } = useToasts();
  // гість (без реєстрації) реєструється, щоб зберегти дискусію — форму йому показуємо.
  // Позначку беремо один раз: після входу вона зникає, і редирект нижче не має
  // перебити перехід в історію з перенесеною дискусією
  const [guest] = useState(isGuestSession);
  // уже в акаунті — форма входу не потрібна, одразу в застосунок
  // (позначка застаріла — застосунок отримає 401, зітре її й поверне сюди)
  if (getSession() && !guest) return <Navigate to="/home" replace />;
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
              const signed = await login({
                name: data.name,
                email: data.email,
                password: data.password,
              });
              // дискусію гостя сервер переніс в акаунт — ведемо в історію, де вона лежить
              if (signed?.adopted_discussions) {
                pushToast(copy.guest.adopted, 'success');
                navigate('/history');
              } else {
                navigate('/home');
              }
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
