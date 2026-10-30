import PropTypes from 'prop-types';
import Field from './Field';
import { useForm } from '../hooks/useForm';
import { validateEmail } from '../utils/validate';
import { copy } from '../copy';

const t = copy.login;
const v8n = copy.validation;

const validate = {
  email: (v) => (validateEmail(v) ? '' : v8n.emailInvalid),
  password: (v) => (v ? '' : v8n.passwordRequired),
};

export default function LoginForm({ onSubmit, onSwitch, alternative = null }) {
  // ліміт спроб тримається на бекенді per-акаунт (429 показується тостом)
  const { values, errors, loading, handleChange, handleSubmit } = useForm({
    initialValues: { email: '', password: '' },
    validate,
    labels: t.toastLabels,
    invalidToast: t.invalidToast,
    onSubmit: (v) => onSubmit?.({ email: v.email.trim(), password: v.password }),
  });

  return (
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
      <Field
        label={t.passwordLabel}
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder={t.passwordPlaceholder}
        value={values.password}
        onChange={handleChange}
        error={errors.password}
      />

      <button className="btn" type="submit" disabled={loading}>
        {loading ? t.submitting : t.submit}
      </button>
      {alternative}
      <p className="form__alt">
        <button type="button" className="link link--alt" onClick={() => onSwitch?.()}>
          {t.switchToRegister}
        </button>
      </p>
    </form>
  );
}

LoginForm.propTypes = {
  onSubmit: PropTypes.func,
  onSwitch: PropTypes.func,
  // інший спосіб входу під кнопкою форми (Google)
  alternative: PropTypes.node,
};
