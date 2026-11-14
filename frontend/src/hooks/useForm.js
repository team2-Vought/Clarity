import { useCallback, useState } from 'react';
import { useToasts } from './useToasts';
import { ApiError } from '../api/client';
import { copy } from '../copy';

/**
 * Спільна логіка форм: значення, помилки полів, сабміт, тости.
 * validate: { fieldName: (value, allValues) => errorMessage | '' }
 * labels: { fieldName: 'Коротка назва' } — для детального тосту помилок
 */
export function useForm({
  initialValues,
  validate,
  labels,
  onSubmit,
  invalidToast,
  onError,
  // помилки показані під полями: без тосту, фокус — на перше хибне поле
  inlineErrors = false,
}) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const { pushToast } = useToasts();

  const validateField = useCallback(
    (field, all = values) => {
      const msg = validate[field](all[field], all);
      setErrors((e) => ({ ...e, [field]: msg }));
      return msg;
    },
    [validate, values],
  );

  const handleChange = useCallback(
    (e) => {
      const { name, value } = e.target;
      const next = { ...values, [name]: value };
      setValues(next);
      if (errors[name]) {
        const msg = validate[name](value, next);
        setErrors((prev) => ({ ...prev, [name]: msg }));
      }
      if (name === 'password' && errors.repeat && validate.repeat) {
        const msg = validate.repeat(next.repeat, next);
        setErrors((prev) => ({ ...prev, repeat: msg }));
      }
    },
    [errors, validate, values],
  );

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      const fieldResults = {};
      for (const f of Object.keys(validate)) {
        fieldResults[f] = validate[f](values[f], values);
        setErrors((prev) => ({ ...prev, [f]: fieldResults[f] }));
      }
      const failed = Object.entries(fieldResults).filter(([, msg]) => msg);
      if (failed.length > 0) {
        if (inlineErrors) {
          const form = e.currentTarget || e.target;
          form?.querySelector?.(`[name="${failed[0][0]}"]`)?.focus();
          return;
        }
        // тост із конкретними причинами: "Пароль: занадто короткий; Пошта: ..."
        const details = failed
          .map(([field, msg]) => (labels?.[field] ? `${labels[field]}: ${msg}` : msg))
          .join('; ');
        pushToast(details || invalidToast);
        return;
      }
      try {
        setLoading(true);
        await onSubmit?.(values);
      } catch (err) {
        if (err instanceof ApiError) {
          const fieldErrors = err.fieldErrors();
          if (Object.keys(fieldErrors).length > 0) {
            setErrors((prev) => ({ ...prev, ...fieldErrors }));
          } else {
            pushToast(err.message);
          }
        } else {
          pushToast(copy.errors.unexpected);
        }
        onError?.(err);
      } finally {
        setLoading(false);
      }
    },
    [inlineErrors, invalidToast, labels, onError, onSubmit, pushToast, validate, values],
  );

  return { values, errors, loading, handleChange, validateField, handleSubmit };
}
