import { Component } from 'react';
import PropTypes from 'prop-types';
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
      return (
        <main className="main main--auth">
          <section className="card card--auth" aria-labelledby="error-title">
            <h1 id="error-title">{copy.errors.crashTitle}</h1>
            <p className="hero__text">{copy.errors.crashText}</p>
            <button className="btn" type="button" onClick={() => window.location.reload()}>
              {copy.errors.reload}
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
};
