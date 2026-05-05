import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import admin from "firebase-admin";
import fs from "fs";

// Load Firebase config for initialization
const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));

// Initialize Firebase Admin
// In AI Studio Cloud Run, it should pick up the service account automatically
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: `https://${firebaseConfig.projectId}.firebaseio.com`,
    projectId: firebaseConfig.projectId
  });
}

const db = admin.firestore();
const fcm = admin.messaging();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Endpoint to send a notification (optional, could also be triggered by Firestore listeners)
  app.post("/api/notify", async (req, res) => {
    const { tokens, title, body } = req.body;
    if (!tokens || tokens.length === 0) return res.status(400).json({ error: "No tokens provided" });

    try {
      const response = await fcm.sendEachForMulticast({
        tokens,
        notification: { title, body },
      });
      res.json({ success: true, response });
    } catch (error) {
      console.error("FCM Error:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  // Listen for new logs to notify admins
  db.collection('logs').onSnapshot(async (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === 'added') {
        const log = change.doc.data();
        const premiseName = log.premiseId; // We should ideally join this or store it in log
        
        const message = `${log.volunteerName} ${log.type === 'entry' ? 'entered' : 'left'} the premise.`;
        
        // Notify admins
        const adminSnap = await db.collection('volunteers').where('role', '==', 'admin').get();
        const tokens: string[] = [];
        adminSnap.forEach(doc => {
          const u = doc.data();
          if (u.fcmTokens) {
            tokens.push(...Object.keys(u.fcmTokens));
          }
        });

        if (tokens.length > 0) {
          try {
            await fcm.sendEachForMulticast({
              tokens,
              notification: {
                title: "Attendance Alert",
                body: message,
              },
            });
            console.log(`Sent notification for log ${change.doc.id}`);
          } catch (e) {
            console.error("Error sending notification:", e);
          }
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
