import { useState } from 'react';
import PropTypes from 'prop-types';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon } from '@hugeicons/core-free-icons';
import { copy } from '../../copy';

// Джерела з інтернету: під реплікою, у підсумку й на сторінці за посиланням

const t = copy.chat;

const domainOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const faviconOf = (url) => {
  const domain = domainOf(url);
  return domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : '';
};

function SourceFavicon({ url }) {
  const [failed, setFailed] = useState(false);
  const src = faviconOf(url);
  if (!src || failed) {
    return (
      <span className="chat__source-icon chat__source-icon--letter" aria-hidden="true">
        {(domainOf(url)[0] || '?').toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="chat__source-icon"
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

// Згорнутий вигляд джерел: кілька логотипів і кількість
export function SourcesLabel({ sources }) {
  return (
    <>
      <span className="chat__sources-icons" aria-hidden="true">
        {sources.slice(0, 4).map((source) => (
          <SourceFavicon key={source.id} url={source.url} />
        ))}
      </span>
      {`${t.sources} · ${sources.length}`}
      <HugeiconsIcon icon={ArrowDown01Icon} size={14} className="chat__sources-chevron" />
    </>
  );
}

export function SourceItems({ sources, query = '' }) {
  return (
    <ol>
      {query && <li className="chat__sources-query">{t.searchedFor(query)}</li>}
      {sources.map((source) => (
        <li key={source.id}>
          <a href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>
            <SourceFavicon url={source.url} />
            <span className="chat__source-title">{source.title || domainOf(source.url)}</span>
            <span className="chat__source-domain">{domainOf(source.url)}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

// Згорнуто — рядок із кількома логотипами, розгорнуто — список посилань
export function SourceList({ sources, query = '', compact = false }) {
  return (
    <details className={`chat__sources ${compact ? 'chat__sources--compact' : ''}`}>
      <summary>
        <SourcesLabel sources={sources} />
      </summary>
      <SourceItems sources={sources} query={query} />
    </details>
  );
}

const sourceShape = PropTypes.shape({
  id: PropTypes.number,
  url: PropTypes.string,
  title: PropTypes.string,
});

SourceFavicon.propTypes = { url: PropTypes.string };
SourcesLabel.propTypes = { sources: PropTypes.arrayOf(sourceShape).isRequired };
SourceItems.propTypes = {
  sources: PropTypes.arrayOf(sourceShape).isRequired,
  query: PropTypes.string,
};
SourceList.propTypes = {
  sources: PropTypes.arrayOf(sourceShape).isRequired,
  query: PropTypes.string,
  compact: PropTypes.bool,
};
