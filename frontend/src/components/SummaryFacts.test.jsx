// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SummaryDetails from './SummaryDetails';
import { describeSummary } from '../utils/summary';
import { copy } from '../copy';

const t = copy.chat;
const SUMMARY = { decision: 'Вчити Go.', headline: 'Go', answer: '' };

const renderSummary = (factChecks) =>
  render(
    <SummaryDetails
      summary={SUMMARY}
      view={describeSummary(SUMMARY)}
      sources={new Map()}
      factChecks={factChecks}
    />
  );

describe('перевірка чисел у висновку', () => {
  it('каже, скільки перевірено й виправлено, і розгортає деталі', async () => {
    renderSummary([
      { claim: '5–10 год на тиждень ≈ 50 год на рік', ok: false, correct: '260–520 год' },
      { claim: 'Go має goroutines', ok: true, correct: '' },
    ]);
    await userEvent.click(screen.getByText(t.factChecksSummary(2, 1)));
    expect(screen.getByText(/260–520 год/)).toBeTruthy();
  });

  it('без перевірок рядка немає', () => {
    renderSummary(undefined);
    expect(screen.queryByText(/AI Devil/)).toBeNull();
  });
});
