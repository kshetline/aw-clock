const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');
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
  optimization: {
    minimize: mode === 'production',
    minimizer: [new TerserPlugin({
      terserOptions: {
        output: { max_line_len: 511 }
      }
    })],
  },
  devtool: 'source-map',
  plugins: [
    new webpack.BannerPlugin({ banner: '#!/usr/bin/env node', raw: true })
  ]
};
