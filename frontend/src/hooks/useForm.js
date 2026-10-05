import { useCallback, useState } from 'react';
import { useToasts } from './useToasts';
import { ApiError } from '../api/client';

/**
 * Спільна логіка форм: значення, помилки полів, сабміт, тости.
 * validate: { fieldName: (value, allValues) => errorMessage | '' }
 */
export function useForm({ initialValues, validate, onSubmit, invalidToast }) {
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
      const results = Object.keys(validate).map((f) => {
        const msg = validate[f](values[f], values);
        setErrors((prev) => ({ ...prev, [f]: msg }));
        return msg;
      });
      if (results.some(Boolean)) {
        if (invalidToast) pushToast(invalidToast);
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
          pushToast('Неочікувана помилка');
        }
      } finally {
        setLoading(false);
      }
    },
    [invalidToast, onSubmit, pushToast, validate, values],
  );

  return { values, errors, loading, handleChange, validateField, handleSubmit };
}
