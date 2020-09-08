const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ProgressPlugin = require('webpack/lib/ProgressPlugin');
const CircularDependencyPlugin = require('circular-dependency-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const rxPaths = require('rxjs/_esm5/path-mapping');
const autoprefixer = require('autoprefixer');
const postcssUrl = require('postcss-url');
const postcssImports = require('postcss-import');

const entryPoints = ['inline', 'polyfills', 'sw-register', 'styles', 'vendor', 'main'];
const baseHref = '';
const deployUrl = '';
const projectRoot = process.cwd();
const maximumInlineSize = 10;
const NODE_ENV = process.env.NODE_ENV || 'production';

const postcssPlugins = function (loader) {
  // noinspection JSValidateTypes
  return [
    postcssImports({
      resolve: (url, context) => {
        return new Promise((resolve, reject) => {
          let hadTilde = false;
          if (url && url.startsWith('~')) {
            url = url.substr(1);
            hadTilde = true;
          }
          loader.resolve(context, (hadTilde ? '' : './') + url, (err, result) => {
            if (err) {
              if (hadTilde) {
                reject(err);
                return;
              }
              loader.resolve(context, url, (err, result) => {
                if (err) {
                  reject(err);
                }
                else {
                  resolve(result);
                }
              });
            }
            else {
              resolve(result);
            }
          });
        });
      },
      load: (filename) => {
        return new Promise((resolve, reject) => {
          // noinspection JSValidateTypes
          loader.fs.readFile(filename, (err, data) => {
            if (err) {
              reject(err);
              return;
            }
            const content = data.toString();
            resolve(content);
          });
        });
      }
    }),
    postcssUrl({
      filter: ({ url }) => url.startsWith('~'),
      url: ({ url }) => {
        const fullPath = path.join(projectRoot, 'node_modules', url.substr(1));
        return path.relative(loader.context, fullPath).replace(/\\/g, '/');
      }
    }),
    postcssUrl([
      {
        // Only convert root relative URLs, which CSS-Loader won't process into require().
        filter: ({ url }) => url.startsWith('/') && !url.startsWith('//'),
        url: ({ url }) => {
          if (deployUrl.match(/:\/\//) || deployUrl.startsWith('/')) {
            // If deployUrl is absolute or root relative, ignore baseHref & use deployUrl as is.
            return `${deployUrl.replace(/\/$/, '')}${url}`;
          }
          else if (baseHref.match(/:\/\//)) {
            // If baseHref contains a scheme, include it as is.
            return baseHref.replace(/\/$/, '') +
              `/${deployUrl}/${url}`.replace(/\/\/+/g, '/');
          }
          else {
            // Join together base-href, deploy-url and the original URL.
            // Also dedupe multiple slashes into single ones.
            return `/${baseHref}/${deployUrl}/${url}`.replace(/\/\/+/g, '/');
          }
        }
      },
      {
        url: 'inline',
        // NOTE: maxSize is in KB
        maxSize: maximumInlineSize,
        fallback: 'rebase',
      },
      { url: 'rebase' },
    ]),
    autoprefixer({ grid: true }),
  ];
};

// noinspection JSUnusedGlobalSymbols
module.exports = {
  mode: NODE_ENV,
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
    mainFields: [
      'browser',
      'module',
      'main'
    ]
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
    polyfills: [
      './src/polyfills.ts'
    ],
    styles: [
      './src/styles.scss'
    ]
  },
  output: {
    path: path.join(process.cwd(), 'dist', 'public'),
    filename: '[name].[contenthash].bundle.js',
    chunkFilename: '[id].chunk.js',
    crossOriginLoading: false
  },
  module: {
    rules: [
      {
        test: /\.html$/,
        loader: 'raw-loader'
      },
      {
        test: /\.(eot|svg|cur)$/,
        loader: 'file-loader',
        options: {
          name: '[name].[hash:20].[ext]',
          limit: 10000
        }
      },
      {
        test: /\.(jpg|png|webp|gif|otf|ttf|woff|woff2|ani)$/,
        loader: 'url-loader',
        options: {
          name: '[name].[hash:20].[ext]',
          limit: 10000
        }
      },
      {
        exclude: [
          path.join(process.cwd(), 'src/styles.scss')
        ],
        test: /\.css$/,
        use: [
          {
            loader: 'raw-loader'
          },
          {
            loader: 'postcss-loader',
            options: {
              ident: 'embedded',
              plugins: postcssPlugins,
              sourceMap: true
            }
          }
        ]
      },
      {
        exclude: [
          path.join(process.cwd(), 'src/styles.scss')
        ],
        test: /\.scss$|\.sass$/,
        use: [
          {
            loader: 'raw-loader'
          },
          {
            loader: 'postcss-loader',
            options: {
              ident: 'embedded',
              plugins: postcssPlugins,
              sourceMap: true
            }
          },
          {
            loader: 'sass-loader',
            options: {
              sourceMap: true,
              precision: 8,
              includePaths: []
            }
          }
        ]
      },
      {
        exclude: [
          path.join(process.cwd(), 'src/styles.scss')
        ],
        test: /\.less$/,
        use: [
          {
            loader: 'raw-loader'
          },
          {
            loader: 'postcss-loader',
            options: {
              ident: 'embedded',
              plugins: postcssPlugins,
              sourceMap: true
            }
          },
          {
            loader: 'less-loader',
            options: {
              sourceMap: true
            }
          }
        ]
      },
      {
        exclude: [
          path.join(process.cwd(), 'src/styles.scss')
        ],
        test: /\.styl$/,
        use: [
          {
            loader: 'raw-loader'
          },
          {
            loader: 'postcss-loader',
            options: {
              ident: 'embedded',
              plugins: postcssPlugins,
              sourceMap: true
            }
          },
          {
            loader: 'stylus-loader',
            options: {
              sourceMap: true,
              paths: []
            }
          }
        ]
      },
      {
        include: [
          path.join(process.cwd(), 'src/styles.scss')
        ],
        test: /\.css$/,
        use: [
          'style-loader',
          {
            loader: 'raw-loader'
          },
          {
            loader: 'postcss-loader',
            options: {
              ident: 'embedded',
              plugins: postcssPlugins,
              sourceMap: true
            }
          }
        ]
      },
      {
        include: [
          path.join(process.cwd(), 'src/styles.scss')
        ],
        test: /\.scss$|\.sass$/,
        use: [
          'style-loader',
          {
            loader: 'raw-loader'
          },
          {
            loader: 'postcss-loader',
            options: {
              ident: 'embedded',
              plugins: postcssPlugins,
              sourceMap: true
            }
          },
          {
            loader: 'sass-loader'
          }
        ]
      },
      {
        include: [
          path.join(process.cwd(), 'src/styles.scss')
        ],
        test: /\.less$/,
        use: [
          'style-loader',
          {
            loader: 'raw-loader'
          },
          {
            loader: 'postcss-loader',
            options: {
              ident: 'embedded',
              plugins: postcssPlugins,
              sourceMap: true
            }
          },
          {
            loader: 'less-loader',
            options: {
              sourceMap: true
            }
          }
        ]
      },
      {
        include: [
          path.join(process.cwd(), 'src/styles.scss')
        ],
        test: /\.styl$/,
        use: [
          'style-loader',
          {
            loader: 'raw-loader'
          },
          {
            loader: 'postcss-loader',
            options: {
              ident: 'embedded',
              plugins: postcssPlugins,
              sourceMap: true
            }
          },
          {
            loader: 'stylus-loader',
            options: {
              sourceMap: true,
              paths: []
            }
          }
        ]
      },
      {
        test: /\.ts|\.tsx$/,
        use: 'ts-loader',
        exclude: [/node_modules/, '/server/**/*']
      }
    ]
  },
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin()],
  },
  devtool: 'source-map',
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
    }),
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
  ],
  node: {
    global: true
  },
  devServer: {
    historyApiFallback: true
  }
};
