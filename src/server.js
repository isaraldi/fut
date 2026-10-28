process.env.TZ = 'America/Sao_Paulo';
const { port } = require('./config/env');
require('./loaders/process-errors')();
const App = require('./app');

const { app } = new App();
app.listen(port, () => console.log(`🖥️  Painel administrativo em http://localhost:${port}`));
