import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Bug02Icon } from '@hugeicons/core-free-icons';
import { copy } from '../copy';
import { roleIcon } from '../utils/debateOptions';
import { openBugReport } from '../utils/bugReport';

const t = copy.help;

// Іконки ролей у картках учасників і суддів — ті самі, що в чаті й складі команди
const SECTION_ICONS = {
  cast: ['logician', 'skeptic', 'creative', 'emotional', 'pragmatist'],
  judges: ['moderator', 'devil'],
};

/** «Допомога»: як проходить дискусія, формати, учасники, час, ліміти. */
export default function HelpPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const previous = document.title;
    document.title = `${t.title} · ${copy.appName}`;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="help">
      <article className="help__inner" aria-labelledby="help-title">
        <header className="help__head">
          <h1 id="help-title" className="help__title">{t.title}</h1>
          <p className="help__lead">{t.lead}</p>
          <nav className="help__toc" aria-label={t.contents}>
            {t.sections.map((section) => (
              <a key={section.id} className="help__toc-link" href={`#help-${section.id}`}>
                {section.title}
              </a>
            ))}
          </nav>
        </header>

        {t.sections.map((section) => (
          <section
            key={section.id}
            id={`help-${section.id}`}
            className="help__section"
            aria-labelledby={`help-${section.id}-title`}
          >
            <h2 id={`help-${section.id}-title`} className="help__section-title">{section.title}</h2>
            <p className="help__section-lead">{section.lead}</p>
            {section.kind === 'steps' ? (
              <ol className="help__steps">
                {section.items.map((item, index) => (
                  <li key={item.title} className="help__step">
                    <span className="help__step-num" aria-hidden="true">{index + 1}</span>
                    <div>
                      <h3 className="help__item-title">{item.title}</h3>
                      <p className="help__item-text">{item.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <ul className="help__cards">
                {section.items.map((item, index) => {
                  const role = SECTION_ICONS[section.id]?.[index];
                  return (
                    <li key={item.title} className="help__card">
                      <h3 className="help__item-title">
                        {role && (
                          <span className="help__card-icon" aria-hidden="true">
                            <HugeiconsIcon icon={roleIcon(role)} size={16} strokeWidth={1.8} />
                          </span>
                        )}
                        {item.title}
                      </h3>
                      <p className="help__item-text">{item.text}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}

        <section className="help__report" aria-labelledby="help-report-title">
          <span className="help__report-icon" aria-hidden="true">
            <HugeiconsIcon icon={Bug02Icon} size={22} />
          </span>
          <div className="help__report-text">
            <h2 id="help-report-title" className="help__report-title">{copy.report.trigger}</h2>
            <p className="help__item-text">{copy.report.helpText}</p>
          </div>
          <button type="button" className="help__report-button" onClick={() => openBugReport()}>
            {copy.report.helpAction}
          </button>
        </section>

        <footer className="help__foot">
          <p className="help__disclaimer">{t.disclaimer}</p>
          <button type="button" className="help__start" onClick={() => navigate('/home')}>
            {t.start}
            <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
          </button>
        </footer>
      </article>
    </div>
  );
}
