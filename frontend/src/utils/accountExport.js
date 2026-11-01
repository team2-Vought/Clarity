import { exportAccount } from '../api/auth';
import { downloadText } from './exportMarkdown';

/** Усі дані акаунта одним JSON-файлом (GDPR) — збереження в браузері. */
export async function downloadAccountExport() {
  const data = await exportAccount();
  const date = new Date().toISOString().slice(0, 10);
  downloadText(JSON.stringify(data, null, 1), `clarity-export-${date}.json`, 'application/json;charset=utf-8');
}
