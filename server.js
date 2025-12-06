import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import { db, auth as firebaseAuth } from "./firebaseAdmin.js";  // Firestore + Auth

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/************************************
 * Firebase Auth Token Middleware
 ************************************/
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  // No token = guest user
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await firebaseAuth.verifyIdToken(token);
    req.user = decoded; // contains uid, email, etc.
  } catch (err) {
    console.error("Invalid Firebase token:", err.message);
    req.user = null; // treat invalid tokens as guest
  }

  next();
};

app.use(verifyFirebaseToken);


/************************************
 * Health Check
 ************************************/
app.get("/", (req, res) => {
  res.json({ message: "API-Assertify backend is running" });
});


/************************************
 * POST /proxy
 * - Perform HTTP request
 * - Save history only for authenticated users
 ************************************/
app.post("/proxy", async (req, res) => {
  const { url, method, headers = {}, params = {}, body = null } = req.body;

  if (!url || !method) {
    return res.status(400).json({ success: false, error: "Missing url or method" });
  }

  try {
    // Build full GET URL with query params
    let finalUrl = url;
    if (method.toUpperCase() === "GET" && params && Object.keys(params).length > 0) {
      const urlObj = new URL(url);
      Object.entries(params).forEach(([k, v]) => urlObj.searchParams.append(k, v));
      finalUrl = urlObj.toString();
    }

    // Perform request
    const response = await axios({
      url: finalUrl,
      method,
      headers,
      data: body,
      validateStatus: () => true,
    });

    let docRef = null;

    // Save history ONLY for authenticated users
    if (req.user) {
      docRef = await db.collection("history").add({
        userId: req.user.uid,
        url,
        method,
        headers,
        params,
        body,
        responseStatus: response.status,
        responseData: response.data,
        createdAt: new Date(),
      });
    }

    // ✅ Unified response structure
    res.json({
      success: true,
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: response.data,
        requestId: docRef ? docRef.id : null,
      }
    });

  } catch (error) {
    console.error("Proxy error:", error.message);
    res.status(500).json({
      success: false,
      response: {
        error: error.message,
        requestId: null,
      }
    });
  }
});


/************************************
 * GET /history
 * - Only return authenticated user's history
 * - Guest → returns empty list
 ************************************/
app.get("/history", async (req, res) => {
  if (!req.user) return res.json([]); // Guest → return empty array

  try {
    const snapshot = await db
      .collection("history")
      .where("userId", "==", req.user.uid)
      .orderBy("createdAt", "desc") // Firestore requires createdAt exists
      .limit(50)
      .get();

    const history = snapshot.docs.map(doc => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        url: data.url || "",
        method: data.method || "",
        headers: data.headers || {},
        params: data.params || {},
        body: data.body || null,
        responseStatus: data.responseStatus ?? null,
        responseData: data.responseData ?? null,
        createdAt: data.createdAt ? data.createdAt.toDate() : null
      };
    });

    res.json(history);
  } catch (err) {
    console.error("History fetch error:", err);
    // Return empty array instead of 500
    res.json([]);
  }
});

/************************************
 * POST /collections
 * - Create collection for authenticated user
 ************************************/
app.post("/collections", async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  try {
    const docRef = await db.collection("collections").add({
      userId: req.user.uid,
      name,
      createdAt: new Date(),
    });

    res.json({ id: docRef.id, name });

  } catch (err) {
    console.error("Create collection error:", err);
    res.status(500).json({ error: err.message });
  }
});


/************************************
 * POST /collection-items
 * - Add history item to a user's collection
 ************************************/
app.post("/collection-items", async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const { collectionId, requestId } = req.body;
  if (!collectionId || !requestId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    // Validate ownership
    const collDoc = await db.collection("collections").doc(collectionId).get();
    if (!collDoc.exists || collDoc.data().userId !== req.user.uid) {
      return res.status(403).json({ error: "Collection does not belong to you" });
    }

    // Add item
    const docRef = await db.collection("collection_items").add({
      userId: req.user.uid,
      collectionId,
      requestId,
      createdAt: new Date(),
    });

    res.json({ id: docRef.id });

  } catch (err) {
    console.error("Add to collection error:", err);
    res.status(500).json({ error: err.message });
  }
});


/************************************
 * GET /collections
 * - Return authenticated user's collections + items
 ************************************/
app.get("/collections", async (req, res) => {
  if (!req.user) return res.json([]); // Guest → empty array

  try {
    const snapshot = await db
      .collection("collections")
      .where("userId", "==", req.user.uid)
      .orderBy("createdAt", "desc")
      .get();

    const collections = await Promise.all(snapshot.docs.map(async (doc) => {
      const data = doc.data() || {};

      // Fetch collection items
      const itemsSnap = await db
        .collection("collection_items")
        .where("collectionId", "==", doc.id)
        .where("userId", "==", req.user.uid)
        .get();

      const items = itemsSnap.docs
        .map(d => d.data()?.requestId)
        .filter(Boolean); // remove null/undefined

      return {
        id: doc.id,
        name: data.name || "Untitled Collection",
        items,
        createdAt: data.createdAt ? data.createdAt.toDate() : null
      };
    }));

    res.json(collections);

  } catch (err) {
    console.error("Collections fetch error:", err);
    // Return empty array on error
    res.json([]);
  }
});

/************************************
 * Server Start
 ************************************/
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🔥 Server running on port ${PORT}`));
