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
  const { url, method, headers = {}, params = {}, body = null, userId } = req.body;
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

    let docRef = null;
    if (userId) {
      docRef = await db.collection("history").add({
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
    }

    res.status(response.status).json({
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data,
      requestId: docRef?.id || null,
    });
  } catch (error) {
    console.error("Proxy error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /history?userId=xxx
app.get("/history", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.json([]); // guest data not in backend

  try {
    const snapshot = await db
      .collection("history")
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const history = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Collections
app.post("/collections", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  try {
    const docRef = await db.collection("collections").add({ name, createdAt: new Date() });
    res.json({ id: docRef.id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/collection-items", async (req, res) => {
  const { collectionId, requestId } = req.body;
  if (!collectionId || !requestId) return res.status(400).json({ error: "Missing fields" });

  try {
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

app.get("/collections", async (req, res) => {
  try {
    const snapshot = await db.collection("collections").orderBy("createdAt", "desc").get();
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
