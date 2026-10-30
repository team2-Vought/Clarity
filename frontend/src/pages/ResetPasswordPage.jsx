import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthPage } from './AuthLayout';
import Field from '../components/Field';
import { checkResetLink, confirmPasswordReset } from '../api/auth';
import { useForm } from '../hooks/useForm';
import { PASSWORD_HINT, validatePassword } from '../utils/validate';
import { copy } from '../copy';

const t = copy.reset;
const v8n = copy.validation;

const validate = {
  password: (v) => validatePassword(v) || '',
  repeat: (v, all) => (v && v === all.password ? '' : v8n.mismatch),
};

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { uid = '', token = '' } = useParams();
  // 'checking' | 'valid' | 'invalid': застаріле посилання краще показати одразу,
  // а не після того, як людина двічі набере новий пароль
  const [link, setLink] = useState('checking');

  useEffect(() => {
    let cancelled = false;
    checkResetLink(uid, token)
      .then((data) => !cancelled && setLink(data?.valid ? 'valid' : 'invalid'))
      // сервер недоступний — даємо спробувати; POST сам скаже, якщо посилання недійсне
      .catch(() => !cancelled && setLink('valid'));
    return () => {
      cancelled = true;
    };
  }, [uid, token]);

  const { values, errors, loading, handleChange, handleSubmit } = useForm({
    initialValues: { password: '', repeat: '' },
    validate,
    labels: t.toastLabels,
    invalidToast: t.invalidToast,
    onSubmit: async (v) => {
      await confirmPasswordReset({
        uid,
        token,
        password: v.password,
        confirm_password: v.repeat,
      });
      navigate('/home', { replace: true });
    },
    onError: (err) => {
      if (err?.data?.code === 'invalid_link') setLink('invalid');
    },
  });

  if (link === 'checking') {
    return <AuthPage title={t.title} lead={t.checking} variant="login" form={<div />} />;
  }

  if (link === 'invalid') {
    return (
      <AuthPage
        title={t.invalidTitle}
        lead={t.invalid}
        variant="login"
        form={
          <div className="form">
            <button className="btn" type="button" onClick={() => navigate('/forgot-password')}>
              {t.requestNew}
            </button>
          </div>
        }
      />
    );
  }

  return (
    <AuthPage
      title={t.title}
      lead={t.lead}
      variant="login"
      form={
        <form className="form" onSubmit={handleSubmit} noValidate>
          <Field
            label={t.passwordLabel}
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder={t.passwordPlaceholder}
            value={values.password}
            onChange={handleChange}
            error={errors.password}
            hint={PASSWORD_HINT}
          />
          <Field
            label={t.repeatLabel}
            name="repeat"
            type="password"
            autoComplete="new-password"
            placeholder={t.repeatPlaceholder}
            value={values.repeat}
            onChange={handleChange}
            error={errors.repeat}
          />
          <button className="btn" type="submit" disabled={loading}>
            {loading ? t.submitting : t.submit}
          </button>
        </form>
      }
    />
  );
}
