// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { installErrorReporter, reportError } from './lib/errorReporter';

// Self-repair loop: report crashes (CLAUDE.md → "Self-repair loop").
installErrorReporter();

// A render crash anywhere shows this instead of a blank white page, and is
// reported so the repair loop can pick it up.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { reportError(error, 'render', { componentStack: info && info.componentStack }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', background: '#fafaf9', padding: 16 }}>
        <div style={{ maxWidth: 420, background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1c1917', marginBottom: 8 }}>Something went wrong on this screen</div>
          <div style={{ fontSize: 14, color: '#57534e', marginBottom: 16 }}>The problem has been reported automatically. Reloading usually gets you going again.</div>
          <button type="button" onClick={() => window.location.reload()}
            style={{ background: '#1c1917', color: '#fff', border: 0, borderRadius: 6, padding: '8px 14px', fontSize: 14, cursor: 'pointer' }}>Reload</button>
        </div>
      </div>
    );
  }
}

/* ===================================================================
   Polyfill: window.storage exists in Claude's artifact environment
   but not in a normal browser. We back it with localStorage so the
   prototype code keeps working unchanged until you migrate to Firebase.

   Remove this entire block once App.jsx is fully migrated to Firestore
   (per MIGRATION.md), since at that point nothing should call
   window.storage anymore.
   =================================================================== */
if (typeof window !== 'undefined' && !window.storage) {
  window.storage = {
    get: async (key) => {
      const v = localStorage.getItem(key);
      return v !== null ? { key, value: v, shared: false } : null;
    },
    set: async (key, value) => {
      localStorage.setItem(key, value);
      return { key, value, shared: false };
    },
    delete: async (key) => {
      localStorage.removeItem(key);
      return { key, deleted: true, shared: false };
    },
    list: async (prefix = '') => {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
      return { keys, prefix, shared: false };
    }
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
