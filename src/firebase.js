import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  doc,
  deleteDoc,
} from 'firebase/firestore';

// Centralized Firebase configuration and initialization
const firebaseConfig = {
  apiKey: 'AIzaSyBLKSR6rdZ9ouGZCbTtr1Ph8QZz9ZBZSwg',
  authDomain: 'time-tracker-1f2af.firebaseapp.com',
  projectId: 'time-tracker-1f2af',
  storageBucket: 'time-tracker-1f2af.firebasestorage.app',
  messagingSenderId: '355235558668',
  appId: '1:355235558668:web:a4e8183fc87ea4206a8529',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export {
  app,
  auth,
  db,
  // Auth exports
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  // Firestore exports
  collection,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  doc,
  deleteDoc,
};

