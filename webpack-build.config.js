const nodeExternals = require('webpack-node-externals');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: 'production',
  target: ['es2018', 'web'],
  entry: './build.ts',
  output: {
    path: __dirname,
    filename: `build.js`
  },
  node: {
    __dirname: false,
    __filename: false,
  },
  resolve: {
    extensions: ['.ts', '.js'],
    mainFields: ['fesm2015', 'module', 'main']
  },
  module: {
    rules: [
      {
        test: /\.ts$/i,
        loader: 'ts-loader',
        options: { configFile: 'tsconfig-build.json' },
        exclude: [/\/node_modules\//]
      }
    ]
  },
  externalsPresets: { node: true },
  externals: [nodeExternals()],
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin({
      terserOptions: {
        mangle: false,
        output: { max_line_len: 511 }
      }
    })],
  },
};
