// PDF з підсумком дискусії. pdfmake і шрифти (~1 МБ) вантажимо лише при
// натисканні, щоб не роздувати основний бандл. Вбудований Roboto має
// кирилицю, а текст у PDF лишається виділеним і доступним для пошуку.

import { locale } from '../copy';
import { parseInline } from './markdown';

const INK = '#121212';
const MUTED = '#6b6b75';
const RULE = '#e2e2e8';

let pdfMakePromise = null;

const loadPdfMake = () => {
  if (!pdfMakePromise) {
    pdfMakePromise = Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
    ]).then(([pdfMakeModule, vfsModule]) => {
      const pdfMake = pdfMakeModule.default ?? pdfMakeModule;
      pdfMake.addVirtualFileSystem(vfsModule.default ?? vfsModule);
      return pdfMake;
    }).catch((err) => {
      pdfMakePromise = null;
      throw err;
    });
  }
  return pdfMakePromise;
};

// Інлайн-markdown моделей → фрагменти pdfmake: **жирний** і *курсив* лишаються виділеними
const richText = (value, style = {}) =>
  parseInline(value).flatMap((token) => {
    switch (token.type) {
      case 'strong':
        return richText(token.text, { ...style, bold: true });
      case 'em':
        return richText(token.text, { ...style, italics: true });
      case 'del':
        return richText(token.text, { ...style, decoration: 'lineThrough' });
      case 'link':
        return [{ ...style, text: token.text, link: token.url }];
      default:
        return [{ ...style, text: token.text }];
    }
  });

const labelled = (label, value) => ({
  text: [{ text: `${label}  `, bold: true }, ...richText(String(value))],
  margin: [0, 0, 0, 10],
});

const fileDate = (date) => date.toISOString().slice(0, 10);

/**
 * Будує й завантажує PDF. `summary` — final_summary дискусії, `t` — тексти
 * copy.chat (підписи збігаються з тими, що на сторінці).
 */
export async function downloadSummaryPdf({ question, summary, lists, sources, t }) {
  const pdfMake = await loadPdfMake();
  const now = new Date();
  const content = [
    { text: 'Clarity', color: MUTED, fontSize: 9, margin: [0, 0, 0, 4] },
    { text: question, fontSize: 15, bold: true, margin: [0, 0, 0, 16] },
  ];

  if (summary.answer) content.push(labelled(t.summaryAnswer, summary.answer));
  if (summary.headline) content.push({ text: summary.headline, fontSize: 13, bold: true, margin: [0, 0, 0, 8] });
  content.push(labelled(t.summaryDecision, summary.decision));
  if (summary.confirmed === false && summary.revision) {
    content.push(labelled(t.summaryRevision, summary.revision));
  } else if (summary.confirmed === true) {
    content.push({ text: t.summaryConfirmed, color: MUTED, margin: [0, 0, 0, 10] });
  }

  const meta = [];
  const agreement = summary.agreement?.total ? summary.agreement : null;
  if (agreement) {
    meta.push({ text: `${t.summaryAgreement}  `, bold: true });
    meta.push(t.summaryAgreementValue(agreement.agree, agreement.total));
  }
  if (summary.confidence !== null && summary.confidence !== undefined) {
    if (meta.length) meta.push('     ');
    meta.push({ text: `${t.summaryConfidence}  `, bold: true });
    meta.push(`${summary.confidence}%`);
  }
  if (meta.length) content.push({ text: meta, margin: [0, 0, 0, 14] });

  if (lists.length) {
    content.push({
      table: {
        widths: [110, '*'],
        body: lists.map(({ title, items }) => [
          { text: title, bold: true },
          { ul: items.map((item) => ({ text: richText(item) })), markerColor: MUTED },
        ]),
      },
      layout: {
        hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.6),
        vLineWidth: () => 0,
        hLineColor: () => RULE,
        paddingLeft: () => 0,
        paddingRight: (i) => (i === 0 ? 14 : 0),
        paddingTop: () => 8,
        paddingBottom: () => 8,
      },
      margin: [0, 0, 0, 14],
    });
  }

  const plan = (summary.next_steps || []).filter(Boolean);
  if (plan.length) {
    content.push({ text: t.summaryPlan, bold: true, margin: [0, 0, 0, 6] });
    content.push({ ol: plan.map((item) => ({ text: richText(item) })), margin: [0, 0, 0, 12] });
  } else if (summary.recommendation) {
    content.push(labelled(t.summaryNextStep, summary.recommendation));
  }
  const triggers = (summary.change_triggers || []).filter(Boolean);
  if (triggers.length) {
    content.push({ text: t.summaryTriggers, bold: true, margin: [0, 0, 0, 6] });
    content.push({ ul: triggers.map((item) => ({ text: richText(item) })), markerColor: MUTED, margin: [0, 0, 0, 12] });
  }

  if (sources?.length) {
    content.push({ text: t.sources, bold: true, margin: [0, 8, 0, 6] });
    content.push({
      ol: sources.map((source) => ({
        text: [
          `${source.title} — `,
          { text: source.url, link: source.url, color: MUTED },
        ],
      })),
      fontSize: 9,
    });
  }

  const definition = {
    info: { title: `Clarity — ${t.summary}`, creator: 'Clarity' },
    pageSize: 'A4',
    pageMargins: [48, 48, 48, 56],
    defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.3, color: INK },
    content,
    footer: (page, pages) => ({
      text: `${now.toLocaleDateString(locale)} · ${page} / ${pages}`,
      alignment: 'center',
      fontSize: 8,
      color: MUTED,
      margin: [0, 20, 0, 0],
    }),
  };

  await pdfMake.createPdf(definition).download(`clarity-${fileDate(now)}.pdf`);
}
