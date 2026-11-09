import { useNavigate } from 'react-router-dom';
import StatusPage from '../components/StatusPage';
import { homePath } from '../utils/homePath';
import { copy } from '../copy';

const t = copy.common;

export default function NotFoundPage() {
  const navigate = useNavigate();
  // прийшли за зовнішнім посиланням — «назад» вивів би з сайту, тож лише «додому»
  const canGoBack = window.history.state?.idx > 0;
  return (
    <StatusPage
      mark="404"
      title={t.notFound}
      text={t.notFoundText}
      actions={[
        { label: t.goHome, onClick: () => navigate(homePath()) },
        ...(canGoBack ? [{ label: t.goBack, onClick: () => navigate(-1) }] : []),
      ]}
    />
  );
}
