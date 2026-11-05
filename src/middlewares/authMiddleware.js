const crypto = require('crypto');
const env = require('../config/env');
const supabase = require('../config/db');
const log = require('../utils/logger');

// 1. Verificación HMAC para Webhooks entrantes de Zernio
function verifyZernioSignature(req, res, next) {
  log.info('AUTH_ZERNIO', 'Evaluando firma HMAC del Webhook...');

  if (!env.ZERNIO_WEBHOOK_SECRET) {
    log.warn('AUTH_ZERNIO', 'ZERNIO_WEBHOOK_SECRET no configurado. Saltando validación de firma.');
    return next();
  }

  const signature = req.headers['x-zernio-signature'] || req.headers['x-late-signature'];

  if (!signature) {
    log.error('AUTH_ZERNIO', 'Rechazado: Encabezado de firma ausente.');
    return res.status(401).json({ error: 'Encabezado X-Zernio-Signature/X-Late-Signature ausente' });
  }

  const expectedHash = crypto
    .createHmac('sha256', env.ZERNIO_WEBHOOK_SECRET)
    .update(req.rawBody || '')
    .digest('hex');

  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expectedHash);

  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    log.error('AUTH_ZERNIO', 'Rechazado: La firma HMAC no coincide con el secreto local.');
    return res.status(403).json({ error: 'Firma de Zernio inválida' });
  }

  log.success('AUTH_ZERNIO', 'Firma de Zernio validada con éxito.');
  next();
}

// 2. Middleware de autenticación 2FA con Supabase para endpoints de /api/admin
async function requireSupabaseAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Token de acceso no proporcionado' });
  }

  const token = authHeader.split(' ')[1];

  // Validar token activo en Supabase
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ ok: false, error: 'Sesión no válida o expirada' });
  }

  // Verificar claim 'aal' para confirmar que se completó el 2FA (TOTP)
  try {
    const payloadBase64 = token.split('.')[1];
    const decodedJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
    const jwtPayload = JSON.parse(decodedJson);

    if (jwtPayload.aal !== 'aal2') {
      return res.status(403).json({ ok: false, error: 'Se requiere verificación de doble factor (2FA)' });
    }
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'Formato de token de autenticación inválido' });
  }

  req.user = user;
  next();
}

module.exports = {
  verifyZernioSignature,
  requireSupabaseAuth
};