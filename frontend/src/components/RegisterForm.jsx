import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
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
  terms: (v) => (v ? '' : t.termsRequired),
};

/** «Я приймаю Умови й Політику» — посилання відкриваються в новій вкладці, щоб не втратити форму. */
export function TermsLinks() {
  return (
    <>
      <Link to="/terms" target="_blank" rel="noopener">{t.termsLink}</Link>
      {t.termsAnd}
      <Link to="/privacy" target="_blank" rel="noopener">{t.privacyLink}</Link>
    </>
  );
}

export default function RegisterForm({ onSubmit, onSwitch, alternative = null }) {
  const { values, errors, loading, handleChange, handleSubmit } = useForm({
    initialValues: { name: '', email: '', password: '', repeat: '', terms: false },
    validate,
    labels: t.toastLabels,
    invalidToast: t.invalidToast,
    onSubmit: (v) =>
      onSubmit?.({
        name: v.name.trim(),
        email: v.email.trim(),
        password: v.password,
        confirm_password: v.repeat,
        accept_terms: v.terms,
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

      <div className="form__terms">
        <label className="checkbox" data-invalid={errors.terms ? 'true' : undefined}>
          <input
            type="checkbox"
            name="terms"
            checked={values.terms}
            onChange={(e) => handleChange({ target: { name: 'terms', value: e.target.checked } })}
            aria-invalid={errors.terms ? 'true' : 'false'}
            aria-describedby={errors.terms ? 'terms-error' : undefined}
          />
          <span>
            {t.termsBefore}
            <TermsLinks />
          </span>
        </label>
        {(errors.terms || errors.accept_terms) && (
          <p className="field__msg field__msg--error" id="terms-error">
            {errors.terms || errors.accept_terms}
          </p>
        )}
      </div>

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
