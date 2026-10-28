require('./config/env');
const express = require('express');
const configurarExpress = require('./loaders/express');
const criarRotas = require('./routes');
const { bootstrapAdmin } = require('./api/services/autenticacao.service');

class App {
    constructor() {
        bootstrapAdmin();
        this.app = express();
        configurarExpress(this.app);
        this.app.use(criarRotas());
    }
}

module.exports = App;
