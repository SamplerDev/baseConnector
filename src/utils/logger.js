const log = {
  info: (tag, msg, data = null) => {
    console.log(`[${new Date().toISOString()}] ℹ️  [${tag}] ${msg}`, data ? '\n' + JSON.stringify(data, null, 2) : '');
  },
  success: (tag, msg, data = null) => {
    console.log(`[${new Date().toISOString()}] ✅ [${tag}] ${msg}`, data ? '\n' + JSON.stringify(data, null, 2) : '');
  },
  warn: (tag, msg, data = null) => {
    console.warn(`[${new Date().toISOString()}] ⚠️  [${tag}] ${msg}`, data ? '\n' + JSON.stringify(data, null, 2) : '');
  },
  error: (tag, msg, error = null) => {
    console.error(`[${new Date().toISOString()}] ❌ [${tag}] ${msg}`, error ? '\n' + (error.stack || JSON.stringify(error, null, 2)) : '');
  }
};

module.exports = log;