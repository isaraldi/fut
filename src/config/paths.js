const path = require('path');

const root = path.resolve(__dirname, '../..');
module.exports = {
    root,
    data: path.join(root, 'data'),
    views: path.join(root, 'src/views'),
    public: path.join(root, 'public'),
};
