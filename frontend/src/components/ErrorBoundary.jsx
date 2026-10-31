import { Component } from 'react';
import PropTypes from 'prop-types';
import { Alert02Icon } from '@hugeicons/core-free-icons';
import StatusPage, { homePath } from './StatusPage';
import { copy } from '../copy';

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
  }

  render() {
    if (this.state.hasError) {
      // роутер теж міг упасти — тож «на головну» звичайним посиланням
      return (
        <StatusPage
          icon={Alert02Icon}
          title={copy.errors.crashTitle}
          text={copy.errors.crashText}
          actions={[
            { label: copy.errors.reload, onClick: () => window.location.reload() },
            { label: copy.common.goHome, href: homePath() },
          ]}
        />
      );
    }
    return this.props.children;
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
};
