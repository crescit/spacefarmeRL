// server.js — Space Farmer game server
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('@colyseus/core');
const { FarmRoom } = require('./server/rooms/FarmRoom');

const app = express();
app.disable('x-powered-by');

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'space-farmer' });
});

// Always serve a fresh copy — no stale cache (prevents leftover debug pages)
// Applied to ALL assets: a stale JS/CSS/font bundle can re-introduce old UI.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const gameServer = new Server({ server });

gameServer.define('farm', FarmRoom);

const PORT = process.env.PORT || 8900;
const HOST = process.env.HOST || '0.0.0.0';
gameServer.listen(PORT, HOST);
console.log(`🌾 Space Farmer server running on http://${HOST}:${PORT}`);

// Colyseus installs its own SIGINT/SIGTERM graceful-shutdown handlers.
