const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const nextConfig = require('../next.config');
const bundledWebpack = require('next/dist/compiled/webpack/webpack');

bundledWebpack.init();
const { webpack } = bundledWebpack;

test('public Partner root and testing exports compile with Next development Fast Refresh', async (t) => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'partner-next-refresh-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const packageRoot = path.dirname(path.dirname(require.resolve('@sabalanerp/partner-sales-contracts')));
  // Exercise the installed refresh loader, not a handwritten approximation of its
  // injected import.meta syntax. Resolve both entries through the public exports.
  const config = nextConfig.webpack({
    mode: 'development',
    target: 'web',
    devtool: false,
    cache: false,
    entry: {
      contracts: require.resolve('@sabalanerp/partner-sales-contracts'),
      testing: require.resolve('@sabalanerp/partner-sales-contracts/testing'),
    },
    output: { path: output, filename: '[name].js' },
    resolve: { alias: {} },
    // Graph compilation has its own consumer checks. Keep this regression at
    // the Partner package boundary without substituting any Partner module.
    externals: { '@sabalanerp/contract-product-graph': 'commonjs @sabalanerp/contract-product-graph' },
    module: { rules: [{
      test: /\.js$/,
      include: packageRoot,
      use: require.resolve('next/dist/compiled/@next/react-refresh-utils/dist/loader'),
    }] },
    plugins: [new webpack.HotModuleReplacementPlugin()],
  }, { dev: true, isServer: false });
  const compiler = webpack(config);
  const stats = await new Promise((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close((closeError) => {
        if (error || closeError) reject(error || closeError);
        else resolve(result);
      });
    });
  });
  assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
});
