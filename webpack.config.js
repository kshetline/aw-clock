const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ProgressPlugin = require('webpack/lib/ProgressPlugin');
const CircularDependencyPlugin = require('circular-dependency-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const rxPaths = require('rxjs/_esm5/path-mapping');
const os = require('os');

const enoughRam = os.totalmem() / 0x40000000 > 1.5;
const entryPoints = ['inline', 'sw-register', 'styles', 'vendor', 'main'];
const projectRoot = process.cwd();

// noinspection JSUnusedGlobalSymbols
module.exports = env => { // eslint-disable-line @typescript-eslint/no-unused-vars
  return {
    mode: (env && env.mode) === 'prod' ? 'production' : 'development',
    performance: { hints: false },
    resolve: {
      extensions: [
        '.ts',
        '.js'
      ],
      symlinks: true,
      modules: [
        './src',
        './node_modules'
      ],
      alias: rxPaths(),
      mainFields: ['fesm2015', 'module', 'main']
    },
    resolveLoader: {
      modules: [
        './node_modules'
      ],
      alias: rxPaths()
    },
    entry: {
      main: [
        './src/main.ts'
      ],
      styles: [
        './src/styles.css'
      ]
    },
    output: {
      path: path.join(projectRoot, 'dist', 'public'),
      filename: '[name].[contenthash].bundle.js',
      chunkFilename: '[id].chunk.js',
      crossOriginLoading: false
    },
    module: {
      rules: [
        {
          test: /\.html$/i,
          loader: 'raw-loader'
        },
        {
          test: /\.(eot|svg|cur)$/i,
          loader: 'file-loader',
          options: {
            name: '[name].[hash:20].[ext]',
            limit: 10000
          }
        },
        {
          test: /\.(jpg|png|webp|gif|otf|ttf|woff|woff2|ani)$/i,
          loader: 'url-loader',
          options: {
            name: '[name].[hash:20].[ext]',
            limit: 10000
          }
        },
        {
          include: [
            path.join(projectRoot, 'src/styles.css')
          ],
          test: /\.css$/i,
          use: ['style-loader', 'css-loader']
        },
        {
          test: /\.ts|\.tsx$/i,
          use: 'ts-loader',
          exclude: [/\/node_modules\//, /\/server\/(?!src\/(ntp-data|shared-types|time-poller)\.ts$).*/]
        }
      ]
    },
    optimization: {
      minimize: (env && env.mode) !== 'local',
      minimizer: [new TerserPlugin({
        terserOptions: {
          output: { max_line_len: 511 }
        }
      })],
    },
    devtool: enoughRam ? 'source-map' : undefined,
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          {
            context: 'src',
            to: '',
            from: 'assets/**/*',
            globOptions: {
              dot: true,
              ignore: [
                '.gitkeep',
                '**/.DS_Store',
                '**/Thumbs.db'
              ],
              debug: 'warning'
            }
          },
          {
            context: 'src',
            to: '',
            from: 'favicon.ico'
          }
        ]
      }),
      new ProgressPlugin({}),
      new CircularDependencyPlugin({
        exclude: /([\\/])node_modules([\\/])/,
        failOnError: false,
        onDetected: false,
        cwd: projectRoot
      }),
      new HtmlWebpackPlugin({
        template: './src/index.html',
        filename: './index.html',
        hash: false,
        inject: 'head',
        compile: true,
        favicon: false,
        minify: false,
        cache: true,
        showErrors: true,
        chunks: 'all',
        excludeChunks: [],
        title: 'Webpack App',
        xhtml: true,
        chunksSortMode: function sort(left, right) {
          // noinspection JSUnresolvedVariable
          const leftIndex = entryPoints.indexOf((left.names && left.names[0]) || left.toString());
          // noinspection JSUnresolvedVariable
          const rightIndex = entryPoints.indexOf((right.names && right.names[0]) || right.toString());

          return Math.sign(leftIndex - rightIndex);
        }
      })
    ],
    node: {
      global: true
    },
    devServer: {
      historyApiFallback: true
    }
  };
};
