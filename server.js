import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import { db, auth } from "./firebaseAdmin.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/**
 * -------------------------------------------------------
 * VERIFY FIREBASE TOKEN MIDDLEWARE
 * -------------------------------------------------------
 */
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null; // guest
    return next();
  }

  // FIX: Split simply by space, not "Bearer "
  const idToken = authHeader.split(" ")[1];

  try {
    const decoded = await auth.verifyIdToken(idToken);
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
    };
  } catch (err) {
    console.warn("Token invalid:", err.message);
    req.user = null;
  }

  next();
};

app.use(verifyToken);

/**
 * -------------------------------------------------------
 * HEALTH CHECK
 * -------------------------------------------------------
 */
app.get("/", (req, res) => {
  res.json({ message: "API-Assertify backend is running" });
});

/**
 * -------------------------------------------------------
 * POST /proxy
 * -------------------------------------------------------
 */
app.post("/proxy", async (req, res) => {
  const { url, method, headers = {}, params = {}, body = null } = req.body;

  if (!url || !method) {
    return res.status(400).json({ error: "Missing url or method" });
  }

  try {
    let finalUrl = url;

    if (method.toUpperCase() === "GET" && params && Object.keys(params).length > 0) {
      const urlObj = new URL(url);
      Object.entries(params).forEach(([key, value]) =>
        urlObj.searchParams.append(key, value)
      );
      finalUrl = urlObj.toString();
    }

    const response = await axios({
      url: finalUrl,
      method,
      headers,
      data: body,
      validateStatus: () => true, // allow non-200
    });

    let requestId = null;

    // Save only if logged in
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
      requestId,
    });
  } catch (error) {
    console.error("Proxy error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * -------------------------------------------------------
 * GET /history
 * Requires authenticated user
 * -------------------------------------------------------
 */
app.get("/history", async (req, res) => {
  if (!req.user) {
    return res.status(401).json({
      error: "Unauthorized. Guest users should use local history.",
    });
  }

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
    console.error("History error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * -------------------------------------------------------
 * COLLECTIONS API
 * -------------------------------------------------------
 */

// Create collection
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
    console.error("Create collection error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Add request to collection
app.post("/collection-items", async (req, res) => {
  const { collectionId, requestId } = req.body;

  if (!collectionId || !requestId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const docRef = await db.collection("collection_items").add({
      uid: req.user.uid,
      collectionId,
      requestId,
      createdAt: new Date(),
    });

    res.json({ id: docRef.id });
  } catch (err) {
    console.error("Collection item error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get collections list
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

      collections.push({
        id: doc.id,
        name: data.name,
        requests: items,
      });
    }

    res.json(collections);
  } catch (err) {
    console.error("Collections fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * -------------------------------------------------------
 * START SERVER
 * -------------------------------------------------------
 */

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
