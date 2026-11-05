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

    // 1. Validar credenciales primarias en Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      log.warn('ADMIN_LOGIN_FAIL', `Intento fallido para ${email}: ${authError.message}`);
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas.' });
    }

    // 2. Comprobar si el usuario tiene activado el doble factor de autenticación (TOTP)
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    
    if (factorsError) {
      log.error('ADMIN_MFA_ERR', 'Error listando factores MFA', factorsError);
      return res.status(500).json({ ok: false, error: 'Error verificando 2FA.' });
    }

    const totpFactor = factors?.totp?.find(f => f.status === 'verified');

    // 3. Si tiene 2FA y no ha enviado el código de 6 dígitos, solicitarlo al cliente
    if (totpFactor && !code2FA) {
      return res.json({
        ok: true,
        requires2FA: true,
        factorId: totpFactor.id,
        message: 'Ingresa el código TOTP de 6 dígitos de tu aplicación autenticadora.'
      });
    }

    // 4. Si se proporciona el código 2FA, procesar el Challenge y la Verificación
    if (totpFactor && code2FA && factorId) {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      
      if (challengeError) {
        return res.status(400).json({ ok: false, error: 'No se pudo generar el desafío 2FA.' });
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: code2FA
      });

      if (verifyError) {
        return res.status(401).json({ ok: false, error: 'Código 2FA incorrecto o expirado.' });
      }
    }

    log.success('ADMIN_AUTH_SUCCESS', `Sesión iniciada correctamente para: ${email}`);

    // Devolver el Access Token emitido por Supabase Auth
    return res.json({
      ok: true,
      requires2FA: false,
      token: authData.session.access_token,
      user: {
        id: authData.user.id,
        email: authData.user.email
      }
    });

  } catch (err) {
    log.error('ADMIN_LOGIN_CRITICAL', 'Excepción procesando inicio de sesión', err);
    return res.status(500).json({ ok: false, error: 'Error interno en el servidor de autenticación.' });
  }
}

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
  login, // 👈 Se exporta login aquí
  getConversaciones,
  toggleBot,
  enviarMensajeManual,
  getBorradores,
  aprobarBorrador,
  rechazarBorrador,
  responderTicketWebhook
};