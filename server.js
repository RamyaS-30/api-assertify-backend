import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import { db, auth } from "./firebaseAdmin.js"; // Firestore + Admin Auth

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Middleware to verify Firebase ID token
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null; // guest user
    return next();
  }

  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decoded = await auth.verifyIdToken(idToken);
    req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (err) {
    console.error("Invalid token:", err.message);
    req.user = null; // treat as guest
    next();
  }
};

app.use(verifyToken);

// Health check
app.get("/", (req, res) => {
  res.json({ message: "API-Assertify backend is running" });
});

/**
 * POST /proxy
 * Body: { url, method, headers, params, body }
 */
app.post("/proxy", async (req, res) => {
  const { url, method, headers = {}, params = {}, body = null } = req.body;

  if (!url || !method) return res.status(400).json({ error: "Missing url or method" });

  try {
    let finalUrl = url;
    if (method.toUpperCase() === "GET" && params && Object.keys(params).length > 0) {
      const urlObj = new URL(url);
      Object.entries(params).forEach(([key, value]) => urlObj.searchParams.append(key, value));
      finalUrl = urlObj.toString();
    }

    const response = await axios({
      url: finalUrl,
      method,
      headers,
      data: body,
      validateStatus: () => true,
    });

    let requestId = null;

    // Save request only for logged-in users
    if (req.user) {
      const docRef = await db.collection("history").add({
        uid: req.user.uid,
        url,
        method,
        headers,
        params,
        body,
        responseStatus: response.status,
        responseData: response.data,
        createdAt: new Date(),
      });
      requestId = docRef.id;
    }

    res.status(response.status).json({
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data,
      requestId, // null for guest
    });
  } catch (error) {
    console.error("Proxy error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /history
 * Only for logged-in users
 */
app.get("/history", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const snapshot = await db
      .collection("history")
      .where("uid", "==", req.user.uid)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const history = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * COLLECTIONS
 */

// Create a new collection
app.post("/collections", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const docRef = await db.collection("collections").add({
      uid: req.user.uid,
      name,
      createdAt: new Date(),
    });
    res.json({ id: docRef.id, name, requests: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add request to collection
app.post("/collection-items", async (req, res) => {
  const { collectionId, requestId } = req.body;
  if (!collectionId || !requestId) return res.status(400).json({ error: "Missing fields" });

  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const docRef = await db.collection("collection_items").add({
      uid: req.user.uid,
      collectionId,
      requestId,
      createdAt: new Date(),
    });
    res.json({ id: docRef.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get collections with request IDs
app.get("/collections", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const snapshot = await db
      .collection("collections")
      .where("uid", "==", req.user.uid)
      .orderBy("createdAt", "desc")
      .get();

    const collections = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const itemsSnap = await db
        .collection("collection_items")
        .where("collectionId", "==", doc.id)
        .where("uid", "==", req.user.uid)
        .get();
      const items = itemsSnap.docs.map((d) => d.data().requestId);

      // Use `requests` to match frontend
      collections.push({ id: doc.id, name: data.name, requests: items });
    }

    res.json(collections);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
