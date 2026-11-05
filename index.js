const app = require('./src/app');
const env = require('./src/config/env');
const log = require('./src/utils/logger');

app.listen(env.PORT, () => {
  log.success('SERVER_BOOT', `🚀 Servidor Express activo en puerto ${env.PORT}`);
});