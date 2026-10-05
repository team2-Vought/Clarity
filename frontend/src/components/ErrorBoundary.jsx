import { Component } from 'react';
import PropTypes from 'prop-types';

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
            <h1 id="error-title">Щось пішло не так</h1>
            <p className="hero__text">Спробуйте оновити сторінку. Якщо помилка повториться — напишіть нам.</p>
            <button className="btn" type="button" onClick={() => window.location.reload()}>
              Оновити сторінку
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
