import PropTypes from 'prop-types';
import Field from './Field';
import { useForm } from '../hooks/useForm';
import { PASSWORD_HINT, validateEmail, validatePassword } from '../utils/validate';
import { copy } from '../copy';

const t = copy.register;
const v8n = copy.validation;

const validate = {
  name: (v) => (v.trim() ? '' : v8n.nameRequired),
  email: (v) => (validateEmail(v) ? '' : v8n.emailInvalid),
  password: (v) => validatePassword(v) || '',
  repeat: (v, all) => (v && v === all.password ? '' : v8n.mismatch),
};

export default function RegisterForm({ onSubmit, onSwitch, alternative = null }) {
  const { values, errors, loading, handleChange, handleSubmit } = useForm({
    initialValues: { name: '', email: '', password: '', repeat: '' },
    validate,
    labels: t.toastLabels,
    invalidToast: t.invalidToast,
    onSubmit: (v) =>
      onSubmit?.({
        name: v.name.trim(),
        email: v.email.trim(),
        password: v.password,
        confirm_password: v.repeat,
      }),
  });

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <Field
        label={t.nameLabel}
        name="name"
        autoComplete="name"
        placeholder={t.namePlaceholder}
        value={values.name}
        onChange={handleChange}
        error={errors.name}
      />
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
      {alternative}
      <p className="form__alt">
        <button type="button" className="link link--alt" onClick={() => onSwitch?.()}>
          {t.switchToLogin}
        </button>
      </p>
    </form>
  );
}

RegisterForm.propTypes = {
  onSubmit: PropTypes.func,
  onSwitch: PropTypes.func,
  // інший спосіб входу під кнопкою форми (Google)
  alternative: PropTypes.node,
};
