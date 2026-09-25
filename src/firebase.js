// src/firebase.js
// Single source of truth for Firebase service instances.
// Paste your config from Firebase Console → Project Settings → Your apps → SDK setup

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: "AIzaSyCIK_hiG7ed9OvO95E-bd-sEHXFl9sBfnA",
  authDomain: "ind-lmt.firebaseapp.com",
  projectId: "ind-lmt",
  storageBucket: "ind-lmt.firebasestorage.app",
  messagingSenderId: "9450023146",
  appId: "1:9450023146:web:093f5e9f21a57bb5d58f93"
};


export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export const fns  = getFunctions(app, 'us-south1');
