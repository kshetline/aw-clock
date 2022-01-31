const path = require('path');
const ROOT = path.resolve(__dirname, 'src');
const SERVER = path.resolve(__dirname, 'server');
const NODE_ENV = process.env.NODE_ENV || 'development';

module.exports = {
  mode: NODE_ENV,
  performance: { hints: false },
  context: ROOT,

  resolve: {
    extensions: ['.ts', '.js'],
    modules: [
      ROOT,
      'node_modules'
    ]
  },

  module: {
    rules: [
      // PRE-LOADERS
      {
        enforce: 'pre',
        test: /\.js$/,
        exclude: [SERVER],
        use: 'source-map-loader'
      },

      // LOADERS
      {
        test: /\.(css|html)$/i,
        loader: 'raw-loader'
      },
      {
        test: /\.ts$/,
        exclude: [/node_modules/, SERVER],
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true
          }
        }
      }
    ]
  },

  devtool: 'cheap-module-source-map',
  devServer: {
    watchedFiles: ['src/**/*.ts', 'src/index.html']
  }
};
