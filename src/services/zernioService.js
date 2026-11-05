const axios = require('axios');
const env = require('../config/env');
const log = require('../utils/logger');

function splitTextIntoChunks(text, maxChunkSize = 3500) {
  if (!text || text.length <= maxChunkSize) return [text];

  const chunks = [];
  let currentChunk = '';
  const lines = text.split('\n');

  for (const line of lines) {
    if ((currentChunk + '\n' + line).length > maxChunkSize) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      if (line.length > maxChunkSize) {
        const words = line.split(' ');
        for (const word of words) {
          if ((currentChunk + ' ' + word).length > maxChunkSize) {
            chunks.push(currentChunk.trim());
            currentChunk = word;
          } else {
            currentChunk += (currentChunk ? ' ' : '') + word;
          }
        }
      } else {
        currentChunk = line;
      }
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

async function sendSingleZernioMessage(target, text, fallbackPhone = null) {
  const isConversationId = typeof target === 'string' && target.length === 24 && !target.startsWith('+');

  let endpoint = '';
  let payload = {};

  if (isConversationId) {
    endpoint = `https://zernio.com/api/v1/inbox/conversations/${target}/messages`;
    payload = {
      accountId: env.ZERNIO_ACCOUNT_ID,
      message: text
    };
  } else {
    const participantId = String(target).replace(/\D/g, '');
    endpoint = `https://zernio.com/api/v1/inbox/conversations`;
    payload = {
      accountId: env.ZERNIO_ACCOUNT_ID,
      participantId: participantId,
      message: text
    };
  }

  log.info('ZERNIO_SEND', `Iniciando envío a [${target}]...`, payload);

  try {
    const startTime = Date.now();
    const response = await axios.post(
      endpoint,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${env.ZERNIO_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    const duration = Date.now() - startTime;
    log.success('ZERNIO_SEND_OK', `Mensaje entregado a [${target}] en ${duration}ms`, response.data);
    return response.data;
  } catch (err) {
    const errData = err.response?.data;
    log.error('ZERNIO_SEND_ERR', `Falla enviando a [${target}]`, errData || err.message);

    if (isConversationId && (errData?.code === 'CONVERSATION_NOT_FOUND' || err.response?.status === 404)) {
      const phoneToUse = fallbackPhone || target;
      log.warn('ZERNIO_FALLBACK', `Reintentando envío por participantId (${phoneToUse})...`);
      return sendSingleZernioMessage(phoneToUse, text);
    }
  }
}

async function sendZernioMessage(target, text, fallbackPhone = null) {
  if (!text) return;

  if (text.length > 3500) {
    const chunks = splitTextIntoChunks(text, 3500);
    log.info('ZERNIO_SPLIT', `Mensaje de ${text.length} caracteres fraccionado en ${chunks.length} partes.`);

    for (let i = 0; i < chunks.length; i++) {
      const isLastPart = i === chunks.length - 1;
      const chunkText = `${chunks[i]}${chunks.length > 1 ? `\n\n_(Parte ${i + 1} de ${chunks.length})_` : ''}`;

      await sendSingleZernioMessage(target, chunkText, fallbackPhone);

      if (!isLastPart) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }
    return;
  }

  return await sendSingleZernioMessage(target, text, fallbackPhone);
}

module.exports = { sendZernioMessage };