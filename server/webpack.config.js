const webpack = require('webpack');
const path = require('path');
const NODE_ENV = process.env.NODE_ENV || 'production'; // 'development' | 'production' | 'none'

// noinspection WebpackConfigHighlighting
module.exports = {
  mode: NODE_ENV, // TODO: Why is there a warning that "mode" isn't allowed?
  entry: './src/app.ts',
  target: 'node',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'app.js'
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
    'node-dht-sensor': 'commonjs node-dht-sensor'
  },
  devtool: 'source-map',
  plugins: [
    new webpack.BannerPlugin({ banner: '#!/usr/bin/env node', raw: true }),
  ]
};
