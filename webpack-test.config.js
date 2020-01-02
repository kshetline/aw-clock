const path = require('path');
const ROOT = path.resolve( __dirname, 'src' );

module.exports = {
  context: ROOT,

  resolve: {
    extensions: ['.ts', '.js'],
    modules: [
      ROOT,
      'node_modules',
      'server/node_modules'
    ]
  },

  module: {
    rules: [
      // PRE-LOADERS
      {
        enforce: 'pre',
        test: /\.js$/,
        use: 'source-map-loader'
      },

      // LOADERS
      {
        test: s => s.endsWith('.ts') && !s.endsWith('/ntp.ts'),
        exclude: [ /node_modules/ ],
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true
          }
        }
      },
      {
        test: /\/ntp\.ts$/,
        use: 'null-loader'
      }
    ]
  },

  devtool: 'cheap-module-source-map',
  devServer: {}
};
