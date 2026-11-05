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
    return res.status(401).json({ ok: false, error: 'Encabezado X-Zernio-Signature/X-Late-Signature ausente' });
  }

  try {
    const expectedHash = crypto
      .createHmac('sha256', env.ZERNIO_WEBHOOK_SECRET)
      .update(req.rawBody || '')
      .digest('hex');

    const sigBuffer = Buffer.from(signature);
    const expBuffer = Buffer.from(expectedHash);

    if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
      log.error('AUTH_ZERNIO', 'Rechazado: La firma HMAC no coincide con el secreto local.');
      return res.status(403).json({ ok: false, error: 'Firma de Zernio inválida' });
    }

    log.success('AUTH_ZERNIO', 'Firma de Zernio validada con éxito.');
    next();
  } catch (err) {
    log.error('AUTH_ZERNIO_ERR', 'Error procesando firma HMAC', err);
    return res.status(500).json({ ok: false, error: 'Error interno validando firma HMAC' });
  }
}

// 2. Middleware de autenticación y verificación AAL2 (2FA/TOTP) con Supabase
async function requireSupabaseAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      log.warn('AUTH_MW_REJECT', `Petición sin token Bearer desde IP: ${req.ip}`);
      return res.status(401).json({ ok: false, error: 'Acceso denegado: Token de autorización ausente.' });
    }

    const token = authHeader.split(' ')[1];

    // Validar token activo en Supabase Auth
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      log.warn('AUTH_MW_REJECT', `Token inválido o expirado desde IP: ${req.ip}`);
      return res.status(401).json({ ok: false, error: 'Sesión no válida o expirada. Inicie sesión nuevamente.' });
    }

    // Decodificar el JWT para verificar el claim 'aal' (Exigir 2FA / AAL2)
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) {
      return res.status(401).json({ ok: false, error: 'Formato de token de autenticación malformado.' });
    }

    const decodedJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
    const jwtPayload = JSON.parse(decodedJson);

    if (jwtPayload.aal !== 'aal2') {
      log.warn('AUTH_MW_AAL_REJECT', `Intento de acceso sin 2FA (AAL1) para el usuario: ${user.email}`);
      return res.status(403).json({ ok: false, error: 'Se requiere verificación de doble factor (2FA/TOTP).' });
    }

    // Inyectar el usuario autenticado y el token en el request
    req.user = user;
    req.accessToken = token;

    next();
  } catch (err) {
    log.error('AUTH_MW_CRITICAL', 'Excepción validando token JWT / AAL2', err);
    return res.status(500).json({ ok: false, error: 'Error interno validando la sesión.' });
  }
}

module.exports = {
  verifyZernioSignature,
  requireSupabaseAuth
};