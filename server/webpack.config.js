const webpack = require('webpack');
const path = require('path');
const mode = process.env.NODE_ENV || 'production';

module.exports = {
  mode,
  entry: './src/app.ts',
  target: 'node',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'app.js'
  },
  node: {
    __dirname: false,
    __filename: false,
  },
  resolve: {
    extensions: ['.ts', '.js'],
    mainFields: ['main', 'main-es5']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [
          'ts-loader',
        ]
      }
    ]
  },
  externals: {
    'i2c-bus': 'commonjs i2c-bus',
    'node-dht-sensor': 'commonjs node-dht-sensor',
    'rpi-acu-rite-temperature': 'commonjs rpi-acu-rite-temperature'
  },
  devtool: 'source-map',
  plugins: [
    new webpack.BannerPlugin({ banner: '#!/usr/bin/env node', raw: true }),
    function () {
      this.plugin('done', stats => {
        if (stats.compilation.errors && stats.compilation.errors.length > 0) {
          if (stats.compilation.errors.length === 0)
            console.error(stats.compilation.errors[0]);
          else {
            console.error(stats.compilation.errors.map(err =>
              err && typeof err === 'object' && err.message ? err.message : '').join('\n'));
          }

          process.exit(1);
        }
      });
    }
  ]
};
