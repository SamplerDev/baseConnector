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

// Seguridad HTTP y Rate Limit (Helmet CSP Completo)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://cdn.tailwindcss.com",
          "https://cdn.jsdelivr.net" // Para cliente Supabase y DOMPurify por CDN
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

// ------------------------------------------------------------------
// CONFIGURACIÓN DE ARCHIVOS ESTÁTICOS PARA EL PANEL ADMIN (public/admin)
// ------------------------------------------------------------------
const adminDir = path.resolve(__dirname, '../public/admin');

// 1. Servir los archivos estáticos de /public/admin bajo la ruta /admin
app.use('/admin', express.static(adminDir));

// 2. Fallback para entregar index.html al navegar a /admin o /admin/
app.get('/admin*', (req, res) => {
  res.sendFile(path.join(adminDir, 'index.html'), (err) => {
    if (err) {
      log.error('ADMIN_STATIC_ERR', `No se encontró index.html en: ${adminDir}`, err);
      res.status(404).send('Error: No se encontró la vista del panel administrativo.');
    }
  });
});

// Montar Rutas de la Aplicación
app.use('/', routes);

module.exports = app;