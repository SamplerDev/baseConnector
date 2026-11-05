const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');
const supabase = require('../config/db');
const zernioService = require('../services/zernioService');
const { procesarRespuestaAdmin } = require('../services/adminService');
const log = require('../utils/logger');

async function login(req, res) {
  try {
    const { email, password, code2FA, factorId } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Correo electrónico y contraseña requeridos.' });
    }

    // 1. Validar correo y contraseña (Obtener sesión AAL1)
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      log.warn('ADMIN_LOGIN_FAIL', `Intento fallido para ${email}: ${authError.message}`);
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' });
    }

    // Instancia temporal con el token del usuario para consultar MFA
    const userClient = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${authData.session.access_token}` } }
    });

    // 2. Consultar factores 2FA del usuario
    // 2. Consultar factores 2FA del usuario
    const { data: factors, error: factorsError } = await userClient.auth.mfa.listFactors();
    if (factorsError) {
      log.error('ADMIN_MFA_ERR', 'Error consultando factores 2FA', factorsError);
      return res.status(500).json({ ok: false, error: 'Error verificando estado 2FA.' });
    }

    const verifiedFactor = factors?.totp?.find(f => f.status === 'verified');

    // Si ya hay un factor verificado y no vino el código 2FA, pedirlo
    if (verifiedFactor && !code2FA && !factorId) {
      return res.json({
        ok: true,
        requires2FA: true,
        isFirstTime: false,
        factorId: verifiedFactor.id,
        message: 'Ingresa el código TOTP de 6 dígitos de tu aplicación autenticadora.'
      });
    }

    // Si se envió el código para verificar un factor existente
    if (code2FA && factorId) {
      const { data: challengeData, error: challengeError } = await userClient.auth.mfa.challenge({ factorId });
      if (challengeError) return res.status(400).json({ ok: false, error: 'Error al generar el desafío 2FA.' });

      const { data: verifyData, error: verifyError } = await userClient.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: code2FA
      });

      if (verifyError) return res.status(401).json({ ok: false, error: 'Código 2FA incorrecto o expirado.' });

      log.success('ADMIN_AUTH_SUCCESS', `Login 2FA completado para: ${email}`);
      return res.json({
        ok: true,
        requires2FA: false,
        token: verifyData.access_token,
        user: { id: authData.user.id, email: authData.user.email }
      });
    }

    // Si llegamos aquí, es un nuevo enrolamiento: eliminamos cualquier factor TOTP anterior residual
    const allTotpFactors = factors?.totp || [];
    for (const factor of allTotpFactors) {
      await userClient.auth.mfa.unenroll({ factorId: factor.id });
    }

    // Generar nuevo Código QR de enrolamiento con nombre único basado en timestamp
    const { data: enrollData, error: enrollError } = await userClient.auth.mfa.enroll({ 
      factorType: 'totp',
      friendlyName: `Viajecito Admin ${Date.now()}`
    });
    
    if (enrollError) {
      log.error('ADMIN_ENROLL_ERR', 'Error generando QR de 2FA', enrollError);
      return res.status(500).json({ ok: false, error: 'No se pudo generar el código QR para 2FA.' });
    }

    return res.json({
      ok: true,
      requires2FA: true,
      isFirstTime: true,
      factorId: enrollData.id,
      qrCode: enrollData.totp.qr_code,
      secret: enrollData.totp.secret,
      message: 'Escanea el código QR con Google Authenticator o Authy para vincular tu cuenta.'
    });
    
  } catch (err) {
    log.error('ADMIN_LOGIN_CRITICAL', 'Excepción procesando autenticación', err);
    return res.status(500).json({ ok: false, error: 'Error interno en la autenticación.' });
  }
}

// RESTO DE FUNCIONES DEL CONTROLADOR
async function getConversaciones(req, res) {
  try {
    const { data, error } = await supabase
      .from('conversaciones')
      .select('*, chat_sesiones(*)')
      .order('ultimo_mensaje', { ascending: false });

    if (error) throw error;
    res.status(200).json({ ok: true, conversaciones: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function toggleBot(req, res) {
  const { phone_number, bot_activo } = req.body;
  try {
    const { data, error } = await supabase
      .from('conversaciones')
      .update({ bot_activo })
      .eq('phone_number', phone_number)
      .select();

    if (error) throw error;
    res.status(200).json({ ok: true, estado: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function enviarMensajeManual(req, res) {
  const { phone_number, mensaje } = req.body;
  try {
    await zernioService.sendZernioMessage(phone_number, mensaje);

    await supabase.from('chat_sesiones').insert([{
      phone_number,
      role: 'human',
      content: mensaje
    }]);

    await supabase.from('conversaciones').update({
      bot_activo: false,
      ultimo_mensaje: new Date()
    }).eq('phone_number', phone_number);

    res.status(200).json({ ok: true, mensaje: 'Mensaje enviado manualmente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function getBorradores(req, res) {
  try {
    const { data, error } = await supabase
      .from('ofertas_borrador')
      .select('*')
      .eq('estado', 'PENDIENTE')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json({ ok: true, borradores: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function aprobarBorrador(req, res) {
  const { id } = req.params;
  const datosEditados = req.body;

  try {
    const { data: ofertaPublicada, error: pubErr } = await supabase
      .from('ofertas_publicadas')
      .insert([{
        destino: datosEditados.destino,
        fecha_salida: datosEditados.fecha_salida,
        duracion: datosEditados.duracion,
        hotel: datosEditados.hotel,
        regimen_comida: datosEditados.regimen_comida,
        inclusiones: datosEditados.inclusiones,
        precio_promo: datosEditados.precio_promo,
        promocion: datosEditados.promocion,
        contacto: datosEditados.contacto,
        cupos: datosEditados.cupos || 1,
        activo: true
      }])
      .select()
      .single();

    if (pubErr) throw pubErr;

    await supabase
      .from('ofertas_borrador')
      .update({ estado: 'APROBADO' })
      .eq('id', id);

    res.json({ ok: true, mensaje: 'Oferta validada y publicada con éxito', oferta: ofertaPublicada });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function rechazarBorrador(req, res) {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('ofertas_borrador')
      .update({ estado: 'RECHAZADO' })
      .eq('id', id);

    if (error) throw error;
    res.json({ ok: true, mensaje: 'Borrador descartado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function responderTicketWebhook(req, res) {
  const { admin_phone, admin_message } = req.body;
  try {
    const resultado = await procesarRespuestaAdmin(admin_phone, admin_message);
    res.status(200).json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
}

module.exports = {
  login,
  getConversaciones,
  toggleBot,
  enviarMensajeManual,
  getBorradores,
  aprobarBorrador,
  rechazarBorrador,
  responderTicketWebhook
};