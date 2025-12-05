import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import { db } from "./firebaseAdmin.js"; // Firestore only

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({ message: "API-Assertify backend is running" });
});

/**
 * POST /proxy
 * Body: { url, method, headers, params, body, userId }
 */
app.post("/proxy", async (req, res) => {
  const { url, method, headers = {}, params = {}, body, userId } = req.body;

  if (!url || !method) return res.status(400).json({ error: "Missing url or method" });

  try {
    let finalUrl = url;
    if (method.toUpperCase() === "GET" && Object.keys(params).length > 0) {
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

    // Only save to Firebase if userId exists (logged-in user)
    let requestId = null;
    if (userId) {
      const docRef = await db.collection("history").add({
        url,
        method,
        headers,
        params,
        body,
        responseStatus: response.status,
        responseData: response.data,
        userId,
        createdAt: new Date(),
      });
      requestId = docRef.id;
    }

    res.status(response.status).json({
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data,
      requestId,
    });
  } catch (error) {
    console.error("Proxy error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get last 50 requests for a user
app.get("/history", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId is required" });

  try {
    const snapshot = await db.collection("history")
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const history = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(history);
  } catch (err) {
    console.error("Firestore fetch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create new collection (user-specific)
app.post("/collections", async (req, res) => {
  const { name, userId } = req.body;
  if (!name || !userId) return res.status(400).json({ error: "Name and userId are required" });

  try {
    const docRef = await db.collection("collections").add({
      name,
      userId,
      createdAt: new Date(),
    });
    res.json({ id: docRef.id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add request to collection
app.post("/collection-items", async (req, res) => {
  const { collectionId, requestId, userId } = req.body;
  if (!collectionId || !requestId || !userId) {
    return res.status(400).json({ error: "Missing fields or userId" });
  }

  try {
    // Only allow logged-in users to add items to collections
    const docRef = await db.collection("collection_items").add({
      collectionId,
      requestId,
      createdAt: new Date(),
    });
    res.json({ id: docRef.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get collections for a user
app.get("/collections", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId is required" });

  try {
    const snapshot = await db
      .collection("collections")
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();

    const collections = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const itemsSnap = await db
        .collection("collection_items")
        .where("collectionId", "==", doc.id)
        .get();
      const items = itemsSnap.docs.map((d) => d.data().requestId);
      collections.push({ id: doc.id, name: data.name, items });
    }

    res.json(collections);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
