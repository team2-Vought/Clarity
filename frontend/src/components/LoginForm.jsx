import PropTypes from 'prop-types';
import Field from './Field';
import { useForm } from '../hooks/useForm';
import { validateEmail, validatePassword } from '../utils/validate';
import { uk } from '../copy/uk';

const t = uk.login;

const validate = {
  email: (v) => (validateEmail(v) ? '' : 'Введіть коректну пошту, наприклад name@mail.com'),
  password: (v) => {
    if (!v) return 'Введіть пароль';
    if (v.length < 9) return 'Занадто короткий пароль';
    return validatePassword(v) || '';
  },
};

export default function LoginForm({ onSubmit, onSwitch }) {
  const { values, errors, loading, handleChange, validateField, handleSubmit } = useForm({
    initialValues: { email: '', password: '' },
    validate,
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
        onBlur={() => validateField('email')}
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
        onBlur={() => values.password && validateField('password')}
        error={errors.password}
      />

      <button className="btn" type="submit" disabled={loading}>
        {loading ? t.submitting : t.submit}
      </button>
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
};
