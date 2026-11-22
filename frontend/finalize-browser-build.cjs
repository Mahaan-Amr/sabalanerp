const path = require('node:path');
const { finalizeBrowserBuild } = require('./browser-build-identity.cjs');
finalizeBrowserBuild({ directory: path.resolve(__dirname, process.env.NEXT_DIST_DIR || '.next-build') });
