// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

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
    <App />
  </React.StrictMode>
);
