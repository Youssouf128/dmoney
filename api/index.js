const { handler } = require('../server');

// Vercel requires `module.exports = handler` et `export default handler` for serverless functions
module.exports = handler;
