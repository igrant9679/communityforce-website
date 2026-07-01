import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { generateSitemap } from "../sitemap";
import { generateBlogRSS, generateCategoryRSS, generateTagRSS } from "../rssGenerator";
import "../scheduledPublishing"; // Start scheduled publishing cron job
import { startEmailDigestCron } from "../jobs/emailDigestCron";
import { ensureAdminUser } from "../localAuth";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Sitemap route
  app.get("/sitemap.xml", generateSitemap);
  
  // RSS feed routes
  app.get("/feed.xml", async (req, res) => {
    try {
      const rss = await generateBlogRSS();
      res.set("Content-Type", "application/rss+xml");
      res.send(rss);
    } catch (error) {
      console.error("[RSS] Error generating blog feed:", error);
      res.status(500).send("Error generating RSS feed");
    }
  });
  
  app.get("/feed/category/:slug.xml", async (req, res) => {
    try {
      const rss = await generateCategoryRSS(req.params.slug);
      if (!rss) {
        res.status(404).send("Category not found");
        return;
      }
      res.set("Content-Type", "application/rss+xml");
      res.send(rss);
    } catch (error) {
      console.error("[RSS] Error generating category feed:", error);
      res.status(500).send("Error generating RSS feed");
    }
  });
  
  app.get("/feed/tag/:slug.xml", async (req, res) => {
    try {
      const rss = await generateTagRSS(req.params.slug);
      if (!rss) {
        res.status(404).send("Tag not found");
        return;
      }
      res.set("Content-Type", "application/rss+xml");
      res.send(rss);
    } catch (error) {
      console.error("[RSS] Error generating tag feed:", error);
      res.status(500).send("Error generating RSS feed");
    }
  });
  
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);

    // Seed local admin account from ADMIN_USERNAME / ADMIN_PASSWORD
    ensureAdminUser().catch(err => console.error("[Auth] Admin seeding failed:", err));

    // Start email digest cron job
    startEmailDigestCron();
  });
}

startServer().catch(console.error);
