process.env.TZ = 'America/Sao_Paulo';
require('./loaders/process-errors')();
const criarCliente = require('./loaders/whatsapp');
const criarHandlers = require('./api/services/whatsapp.service');
const registrarEventos = require('./api/subscribers/whatsapp');

const client = criarCliente();
registrarEventos(client, criarHandlers(client));
client.initialize();
