const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const apiLimiter = require('./middlewares/rateLimiter');
const routes = require('./routes');
const log = require('./utils/logger');

const app = express();

// Confiar en proxy de Hostinger (LiteSpeed)
app.set('trust proxy', 1);

// Seguridad HTTP y Rate Limit
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://cdn.tailwindcss.com",
          "https://cdn.jsdelivr.net" // Para cliente Supabase por CDN
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://*.supabase.co", "https://zernio.com"],
        frameAncestors: ["'none'"], // Evita Clickjacking (no permite iFrames)
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    frameguard: { action: 'deny' }, // Anti-Clickjacking
    noSniff: true, // Prevención de MIME Sniffing
    xssFilter: true, // Filtro XSS legacy para navegadores antiguos
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);
app.use(cors());
app.use(apiLimiter);

// Guardar buffer crudo para la validación HMAC de Zernio
app.use(express.json({
  limit: '15mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Servir la interfaz web del Panel de Administración (ubicado en /admin)
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// Logger de tráfico HTTP
app.use((req, res, next) => {
  const start = Date.now();
  log.info('HTTP_IN', `--> ${req.method} ${req.url} [IP: ${req.ip}]`);

  res.on('finish', () => {
    const duration = Date.now() - start;
    log.info('HTTP_OUT', `<-- ${req.method} ${req.url} ${res.statusCode} [${duration}ms]`);
  });
  next();
});

// Montar Rutas de la Aplicación
app.use('/', routes);

module.exports = app;