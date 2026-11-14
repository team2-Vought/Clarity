import { useState } from 'react';
import PropTypes from 'prop-types';
import { useSearchParams } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Copy01Icon,
  FlashIcon,
  RepeatIcon,
  Share08Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import SummaryDetails from '../SummaryDetails';
import FeedbackBar from './FeedbackBar';
import SaveMenu from './SaveMenu';
import JournalForm, { JournalButton } from './JournalCard';
import { useJournal } from '../../hooks/useJournal';
import MatrixTable from './MatrixTable';
import TreePaths from './TreePaths';
import { TopicNotice } from '../SafetyNotice';
import { SourceItems, SourcesLabel } from './Sources';
import { copy } from '../../copy';
import { inlinePlain } from '../../utils/markdown';
import { downloadSummaryPdf } from '../../utils/summaryPdf';
import { summaryDetailSteps } from '../../utils/summary';

const t = copy.chat;

/**
 * Картка підсумку під чатом: рішення, аргументи й дії з ним — копіювати,
 * зберегти в PDF чи Markdown, поділитися, повторити з тим самим складом.
 * `animate` — частини проявляються по черзі (дискусія йшла на очах).
 */
export default function ChatSummary({
  ref,
  discussion,
  summaryView,
  sourcesById,
  animate = false,
  onExportMarkdown,
  onShare,
  isSharing = false,
  onRepeat,
  onDeepen,
  onOpenTree,
}) {
  const [copyState, setCopyState] = useState('');
  const [pdfState, setPdfState] = useState('');
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  // /chat/<id>?journal=1 — прийшли з журналу записати рішення
  const [params] = useSearchParams();
  const journal = useJournal(discussion, { openInitially: params.get('journal') === '1' });
  const summary = discussion.final_summary;
  const {
    decision: summaryDecision,
    confirmed: summaryConfirmed,
    confidence: summaryConfidence,
    agreement,
    lists: summaryLists,
  } = summaryView;

  const handleCopySummary = async () => {
    const lines = [discussion.question, ''];
    if (summary?.answer) lines.push(`${t.summaryAnswer}: ${inlinePlain(summary.answer)}`);
    lines.push(`${t.summaryDecision}: ${inlinePlain(summaryDecision)}`);
    if (summaryConfirmed === false && summary?.revision) {
      lines.push(`${t.summaryRevision}: ${inlinePlain(summary.revision)}`);
    }
    if (agreement) {
      lines.push(`${t.summaryAgreement}: ${t.summaryAgreementValue(agreement.agree, agreement.total)}`);
    }
    if (summaryConfidence !== null) lines.push(`${t.summaryConfidence}: ${summaryConfidence}%`);
    summaryLists.forEach(({ title, items }) => {
      lines.push('', `${title}:`, ...items.map((item) => `• ${inlinePlain(item)}`));
    });
    if (summaryView.plan.length) {
      lines.push('', `${t.summaryPlan}:`, ...summaryView.plan.map((item, i) => `${i + 1}. ${inlinePlain(item)}`));
    } else if (summary?.recommendation) {
      lines.push('', `${t.summaryNextStep}: ${inlinePlain(summary.recommendation)}`);
    }
    if (summaryView.triggers.length) {
      lines.push('', `${t.summaryTriggers}:`, ...summaryView.triggers.map((item) => `• ${inlinePlain(item)}`));
    }
    if (discussion.sources?.length) {
      lines.push('', `${t.sources}:`);
      discussion.sources.forEach((source) => lines.push(`[${source.id}] ${source.title} — ${source.url}`));
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyState('done');
    } catch {
      setCopyState('error');
    }
    window.setTimeout(() => setCopyState(''), 2000);
  };

  const handleDownloadPdf = async () => {
    if (pdfState === 'busy') return;
    setPdfState('busy');
    try {
      await downloadSummaryPdf({
        question: discussion.question,
        summary: { ...summary, decision: summaryDecision, confirmed: summaryConfirmed, confidence: summaryConfidence },
        lists: summaryLists,
        sources: discussion.sources,
        t,
      });
      setPdfState('');
    } catch {
      setPdfState('error');
      window.setTimeout(() => setPdfState(''), 2500);
    }
  };

  // Частини результату проявляються по черзі, як абзаци реплік
  // дії й джерела проявляються після частин SummaryDetails
  let summaryIndex = summaryDetailSteps(summary, summaryView);
  const summaryStep = () => (animate ? { '--i': summaryIndex++ } : undefined);

  const copyLabel = copyState === 'done' ? t.copied : copyState === 'error' ? t.copyError : t.copySummary;

  return (
    <section
      className={`chat__summary ${animate ? 'chat__summary--enter' : ''}`}
      ref={ref}
      aria-label={t.summary}
    >
      {discussion.quick && (
        <span className="chat__summary-quick">
          <HugeiconsIcon icon={FlashIcon} size={14} aria-hidden="true" />
          {t.quickLabel}
        </span>
      )}
      <SummaryDetails
        summary={summary}
        view={summaryView}
        sources={sourcesById}
        mode={discussion.mode}
        options={discussion.options}
        animate={animate}
        paths={onOpenTree ? <TreePaths tree={discussion.decision_tree} onOpen={onOpenTree} /> : null}
        factChecks={discussion.devil_review?.fact_checks || undefined}
      />
      {discussion.matrix && (
        <div style={summaryStep()}>
          <MatrixTable matrix={discussion.matrix} />
        </div>
      )}
      <div className="chat__summary-actions" style={summaryStep()}>
        {/* іконка й коротке слово: дію видно без наведення; повний опис — у підказці */}
        <button
          type="button"
          className="chat__action"
          onClick={handleCopySummary}
          aria-label={copyLabel}
          title={copyLabel}
        >
          <HugeiconsIcon icon={copyState === 'done' ? Tick02Icon : Copy01Icon} size={16} aria-hidden="true" />
          <span>{copyState === 'done' ? t.copied : t.actions.copy}</span>
        </button>
        {/* формати — в одному меню; копіювання лишається окремою кнопкою */}
        <SaveMenu onPdf={handleDownloadPdf} onMarkdown={onExportMarkdown} busy={pdfState === 'busy'} />
        <button
          type="button"
          className="chat__action"
          onClick={onShare}
          disabled={isSharing}
          aria-label={t.shareAction}
          title={t.shareAction}
        >
          <HugeiconsIcon icon={Share08Icon} size={16} aria-hidden="true" />
          <span>{t.actions.share}</span>
        </button>
        <button
          type="button"
          className="chat__action"
          onClick={onRepeat}
          aria-label={t.repeat}
          title={t.repeat}
        >
          <HugeiconsIcon icon={RepeatIcon} size={16} aria-hidden="true" />
          <span>{t.actions.repeat}</span>
        </button>
        <JournalButton journal={journal} />
        {onDeepen && (
          // коротка відповідь — за кнопкою ті самі учасники в повних дебатах
          <button type="button" className="chat__summary-deepen" onClick={onDeepen} title={t.deepenHint}>
            {t.deepen}
          </button>
        )}
        {/* кнопка — праворуч у рядку дій, а список розкривається під рядком */}
        {discussion.sources?.length > 0 && (
          <button
            type="button"
            className="chat__sources-toggle"
            onClick={() => setIsSourcesOpen((open) => !open)}
            aria-expanded={isSourcesOpen}
            aria-controls="chat-summary-sources"
          >
            <SourcesLabel sources={discussion.sources} />
          </button>
        )}
      </div>
      {discussion.sources?.length > 0 && (
        // список є завжди й плавно розгортається; згорнутий — поза фокусом
        <div
          id="chat-summary-sources"
          className="chat__sources chat__sources--summary"
          data-open={isSourcesOpen ? '' : undefined}
          inert={!isSourcesOpen}
        >
          <div className="chat__sources-fold">
            <SourceItems sources={discussion.sources} />
          </div>
        </div>
      )}
      <JournalForm discussion={discussion} journal={journal} />
      {(copyState === 'error' || pdfState === 'error') && (
        <p className="chat__summary-note" role="alert">
          {copyState === 'error' ? t.copyError : t.pdfError}
        </p>
      )}
      <TopicNotice topic={discussion.safety} className="chat__summary-topic" />
      <div className="chat__summary-after" style={summaryStep()}>
        <FeedbackBar
          discussionId={discussion.id}
          initial={discussion.feedback || ''}
          initialNote={discussion.feedback_note || ''}
        />
      </div>
    </section>
  );
}

ChatSummary.propTypes = {
  ref: PropTypes.oneOfType([PropTypes.func, PropTypes.object]),
  discussion: PropTypes.object.isRequired,
  summaryView: PropTypes.object.isRequired,
  sourcesById: PropTypes.instanceOf(Map).isRequired,
  animate: PropTypes.bool,
  onExportMarkdown: PropTypes.func,
  onShare: PropTypes.func,
  isSharing: PropTypes.bool,
  onRepeat: PropTypes.func,
  onDeepen: PropTypes.func,
  onOpenTree: PropTypes.func,
};
