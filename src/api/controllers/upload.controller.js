const path = require('path');
const multer = require('multer');
const { public: publicDir } = require('../../config/paths');
const { csrfValido } = require('../../helpers/security');
const { getConfig } = require('../services/fut.service');
const { salvarLogo } = require('../services/aparencia.service');
const apresentar = require('../../helpers/apresentar');

const uploadsDir = path.join(publicDir, 'uploads');
const EXTENSOES_PERMITIDAS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/svg+xml': '.svg', 'image/webp': '.webp' };

const uploadLogo = multer({
    storage: multer.diskStorage({
        destination: uploadsDir,
        filename: (req, file, cb) => cb(null, 'logo' + EXTENSOES_PERMITIDAS[file.mimetype]),
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, !!EXTENSOES_PERMITIDAS[file.mimetype]),
});


module.exports = (req, res, next) => {
    uploadLogo.single('logo')(req, res, (err) => {
        // multipart não passa pelo middleware global de CSRF (o multer só processa o campo
        // _csrf aqui, depois de ler o corpo) — confere manualmente antes de aceitar o upload
        if (!csrfValido(req)) {
            return res.status(403).send('Sessão expirada ou formulário desatualizado. Recarregue a página e tente de novo.');
        }

        if (err || !req.file) {
            return res.render('aparencia', {
                usuario: req.session.usuario,
                logoUrl: getConfig('logo_url'),
                erro: 'Não foi possível enviar a imagem. Use PNG, JPG, WEBP ou SVG, até 2MB.',
            });
        }

        try { return apresentar(res, salvarLogo(req.file)); }
        catch (erro) { return next(erro); }
    });
};
