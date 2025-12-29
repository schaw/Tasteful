import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDUk-Fuln5pJHFLw68u7BdG8IpOjsbHKiQ",
  authDomain: "tasteful-74c52.firebaseapp.com",
  projectId: "tasteful-74c52",
  storageBucket: "tasteful-74c52.firebasestorage.app",
  messagingSenderId: "657756055128",
  appId: "1:657756055128:web:f85023238a0b29e30f0c2d",
  measurementId: "G-WXYCJ4GZ8Z"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);

// Initialize Cloud Firestore and get a reference to the service
export const db = getFirestore(app);

export default app;
