import PropTypes from 'prop-types';
import Field from './Field';
import { useForm } from '../hooks/useForm';
import { PASSWORD_HINT, validateEmail, validatePassword } from '../utils/validate';
import { uk } from '../copy/uk';

const t = uk.register;

const validate = {
  name: (v) => (v.trim() ? '' : 'Вкажіть ім’я'),
  email: (v) => (validateEmail(v) ? '' : 'Введіть коректну пошту, наприклад name@mail.com'),
  password: (v) => validatePassword(v) || '',
  repeat: (v, all) => (v && v === all.password ? '' : 'Паролі не збігаються'),
};

export default function RegisterForm({ onSubmit, onSwitch }) {
  const { values, errors, loading, handleChange, validateField, handleSubmit } = useForm({
    initialValues: { name: '', email: '', password: '', repeat: '' },
    validate,
    invalidToast: t.invalidToast,
    onSubmit: (v) => onSubmit?.({ name: v.name.trim(), email: v.email.trim(), password: v.password }),
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
        onBlur={() => validateField('name')}
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
        onBlur={() => validateField('email')}
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
        onBlur={() => values.password && validateField('password')}
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
        onBlur={() => values.repeat && validateField('repeat')}
        error={errors.repeat}
      />

      <button className="btn" type="submit" disabled={loading}>
        {loading ? t.submitting : t.submit}
      </button>
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
};
