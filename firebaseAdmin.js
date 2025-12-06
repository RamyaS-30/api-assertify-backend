import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config(); // Load .env variables

let credential;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Parse the JSON string from environment variable
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  credential = admin.credential.cert(serviceAccount);
} else {
  console.warn(
    "FIREBASE_SERVICE_ACCOUNT not found in .env, using application default credentials"
  );
  credential = admin.credential.applicationDefault();
}

if (!admin.apps.length) {
  admin.initializeApp({ credential });
}

export const auth = admin.auth();
export const db = admin.firestore();
