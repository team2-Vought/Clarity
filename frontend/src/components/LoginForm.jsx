import { useState } from 'react';
import PropTypes from 'prop-types';
import Field from './Field';
import { useForm } from '../hooks/useForm';
import { validateEmail } from '../utils/validate';
import { getAttempts, recordFailure, resetAttempts } from '../utils/loginAttempts';
import { ApiError } from '../api/client';
import { uk } from '../copy/uk';

const t = uk.login;

const validate = {
  name: (v) => (v.trim() ? '' : 'Вкажіть ім’я'),
  email: (v) => (validateEmail(v) ? '' : 'Введіть коректну пошту, наприклад name@mail.com'),
  password: (v) => (v ? '' : 'Введіть пароль'),
};

export default function LoginForm({ onSubmit, onSwitch }) {
  const [notice, setNotice] = useState(() => (getAttempts().locked ? t.attemptsLocked : ''));
  const [locked, setLocked] = useState(() => getAttempts().locked);

  const handleError = (err) => {
    if (!(err instanceof ApiError) || (err.status !== 400 && err.status !== 401)) return;
    const state = recordFailure();
    if (state.locked) {
      setLocked(true);
      setNotice(t.attemptsLocked);
    } else if (state.left === 1 || state.left === 2) {
      setNotice(t.attemptsLeft(state.left));
    } else {
      setNotice('');
    }
  };

  const { values, errors, loading, handleChange, validateField, handleSubmit } = useForm({
    initialValues: { name: '', email: '', password: '' },
    validate,
    invalidToast: t.invalidToast,
    onError: handleError,
    onSubmit: async (v) => {
      if (locked) {
        setNotice(t.attemptsLocked);
        return;
      }
      await onSubmit?.({ name: v.name.trim(), email: v.email.trim(), password: v.password });
      resetAttempts();
      setLocked(false);
      setNotice('');
    },
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
        autoComplete="current-password"
        placeholder={t.passwordPlaceholder}
        value={values.password}
        onChange={handleChange}
        onBlur={() => values.password && validateField('password')}
        error={errors.password}
      />

      {notice && (
        <p className="form__notice" role="alert">
          {notice}
        </p>
      )}

      <button className="btn" type="submit" disabled={loading || locked}>
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
