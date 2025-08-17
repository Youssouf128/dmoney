const { handler } = require('../server');

// Vercel requires `module.export= handler` et `export default handler` for serverless functions
module.exports = handler;
