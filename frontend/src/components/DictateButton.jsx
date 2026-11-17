import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { Mic01Icon } from '@hugeicons/core-free-icons';
import { canDictate, dictate } from '../utils/voice';
import { copy, lang } from '../copy';

const t = copy.voice;

/** Мікрофон біля поля вводу: сказане дописується в поле. Без підтримки в браузері кнопки немає. */
export default function DictateButton({ value, onChange, disabled = false, className = '' }) {
  const [listening, setListening] = useState(false);
  const stopRef = useRef(null);
  // поле могло змінитися, поки людина говорить: дописуємо до свіжого значення
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => () => stopRef.current?.(), []);

  if (!canDictate()) return null;

  const toggle = () => {
    if (listening) {
      stopRef.current?.();
      return;
    }
    setListening(true);
    stopRef.current = dictate({
      lang,
      onText: (text) => {
        if (!text) return;
        const current = valueRef.current;
        const glue = current && !/\s$/.test(current) ? ' ' : '';
        onChange(`${current}${glue}${text}`);
      },
      onEnd: () => {
        setListening(false);
        stopRef.current = null;
      },
    });
  };

  const label = listening ? t.dictateStop : t.dictate;
  return (
    <button
      type="button"
      className={`debate__dictate${listening ? ' debate__dictate--on' : ''} ${className}`.trim()}
      onClick={toggle}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={label}
      title={label}
    >
      <HugeiconsIcon icon={Mic01Icon} size={18} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

DictateButton.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  className: PropTypes.string,
};
