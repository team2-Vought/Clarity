import { Component } from 'react';
import PropTypes from 'prop-types';
import { Alert02Icon } from '@hugeicons/core-free-icons';
import StatusPage, { homePath } from './StatusPage';
import BugReportDialog from './BugReportDialog';
import { copy } from '../copy';
import { openBugReport } from '../utils/bugReport';
import { recordError } from '../utils/diagnostics';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Uncaught error:', error, info);
    // перший рядок стеку компонентів підкаже, де саме впало
    const where = String(info?.componentStack || '').trim().split('\n')[0] || '';
    recordError('crash', `${error?.message || error}${where ? ` ${where.trim()}` : ''}`);
  }

  render() {
    if (this.state.hasError) {
      // роутер теж міг упасти — тож «на головну» звичайним посиланням
      // діалог звернення — тут же: застосунок, у якому він зазвичай живе, упав
      return (
        <>
          <StatusPage
            icon={Alert02Icon}
            title={copy.errors.crashTitle}
            text={copy.errors.crashText}
            actions={[
              { label: copy.errors.reload, onClick: () => window.location.reload() },
              { label: copy.common.goHome, href: homePath() },
              { label: copy.report.crashAction, onClick: () => openBugReport({ kind: 'bug', crash: true }) },
            ]}
          />
          <BugReportDialog />
        </>
      );
    }
    return this.props.children;
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
};
