process.env.TZ = 'America/Sao_Paulo';

require('dotenv').config({ path: require('path').join(require('./paths').root, '.env') });
module.exports = { port: process.env.PORT || 4000 };
