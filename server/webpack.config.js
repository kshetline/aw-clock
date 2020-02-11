const webpack = require('webpack');
const path = require('path');
const NODE_ENV = process.env.NODE_ENV || 'production';

module.exports = {
  mode: NODE_ENV,
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
  ]
};
