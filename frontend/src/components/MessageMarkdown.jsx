import { Fragment } from 'react';
import { parseInline } from '../utils/markdown';

/** Інлайн-розмітка й посилання на джерела [n]. `sources` — Map id → джерело. */
export function InlineText({ text, sources }) {
  return parseInline(text).map((token, index) => {
    switch (token.type) {
      case 'strong':
        return (
          <strong key={index}>
            <InlineText text={token.text} sources={sources} />
          </strong>
        );
      case 'em':
        return (
          <em key={index}>
            <InlineText text={token.text} sources={sources} />
          </em>
        );
      case 'del':
        return (
          <del key={index}>
            <InlineText text={token.text} sources={sources} />
          </del>
        );
      case 'code':
        return <code key={index}>{token.text}</code>;
      case 'link':
        return (
          <a key={index} href={token.url} target="_blank" rel="noopener noreferrer">
            {token.text}
          </a>
        );
      case 'cite': {
        const source = sources?.get(token.id);
        if (!source) return <Fragment key={index}>{token.text}</Fragment>;
        return (
          <a
            key={index}
            className="chat__cite"
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.title}
          >
            {token.text}
          </a>
        );
      }
      default:
        return <Fragment key={index}>{token.text}</Fragment>;
    }
  });
}

function Block({ block, sources, className }) {
  switch (block.type) {
    case 'heading': {
      // «#» і «##» — заголовок частини, «###» і дрібніші — підпис розділу
      const Heading = block.level <= 2 ? 'h3' : 'h4';
      return (
        <Heading className={className}>
          <InlineText text={block.text} sources={sources} />
        </Heading>
      );
    }
    case 'hr':
      return <hr className={className} />;
    case 'ul':
    case 'ol': {
      const List = block.type;
      return (
        <List className={className} start={block.type === 'ol' ? block.start : undefined}>
          {block.items.map((item, index) => (
            // пункти списку з'являються каскадом — затримка задається в CSS
            <li key={index} style={{ '--item': index }}>
              <InlineText text={item} sources={sources} />
            </li>
          ))}
        </List>
      );
    }
    case 'quote':
      return (
        <blockquote className={className}>
          {block.lines.map((line, index) => (
            <p key={index}>
              <InlineText text={line} sources={sources} />
            </p>
          ))}
        </blockquote>
      );
    default:
      return (
        <p className={className}>
          {block.label && <strong>{block.label}:</strong>}
          {block.label && ' '}
          <InlineText text={block.text} sources={sources} />
        </p>
      );
  }
}

/**
 * Блоки репліки. `animate` додає кожному блоку анімацію появи — вона
 * спрацьовує в момент монтування, тож уже показані блоки не блимають.
 */
export default function MessageMarkdown({ blocks, sources, animate = false, children }) {
  return (
    <div className="chat__text">
      {blocks.map((block, index) => (
        <Block
          key={index}
          block={block}
          sources={sources}
          className={animate ? 'chat__reveal' : undefined}
        />
      ))}
      {children}
    </div>
  );
}
