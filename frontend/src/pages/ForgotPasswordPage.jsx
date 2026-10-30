import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthPage } from './AuthLayout';
import Field from '../components/Field';
import { requestPasswordReset } from '../api/auth';
import { useForm } from '../hooks/useForm';
import { validateEmail } from '../utils/validate';
import { copy } from '../copy';

const t = copy.forgot;
const v8n = copy.validation;

const validate = {
  email: (v) => (validateEmail(v) ? '' : v8n.emailInvalid),
};

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  // пошта, на яку пішов лист: після відправки форма змінюється підказкою
  const [sentTo, setSentTo] = useState('');
  const { values, errors, loading, handleChange, handleSubmit } = useForm({
    initialValues: { email: '' },
    validate,
    labels: t.toastLabels,
    invalidToast: t.invalidToast,
    onSubmit: async (v) => {
      const email = v.email.trim();
      await requestPasswordReset(email);
      setSentTo(email);
    },
  });

  const backToLogin = (
    <p className="form__alt">
      <button type="button" className="link link--alt" onClick={() => navigate('/login')}>
        {t.backToLogin}
      </button>
    </p>
  );

  if (sentTo) {
    return (
      <AuthPage
        title={t.sentTitle}
        lead={t.sent(sentTo)}
        variant="login"
        form={
          <div className="form">
            <button className="btn" type="button" onClick={() => setSentTo('')}>
              {t.resend}
            </button>
            {backToLogin}
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
            label={t.emailLabel}
            name="email"
            type="email"
            autoComplete="email"
            placeholder={t.emailPlaceholder}
            value={values.email}
            onChange={handleChange}
            error={errors.email}
          />
          <button className="btn" type="submit" disabled={loading}>
            {loading ? t.submitting : t.submit}
          </button>
          {backToLogin}
        </form>
      }
    />
  );
}
