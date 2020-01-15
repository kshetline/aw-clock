const testsContext = require.context('./', true, /\.spec\.ts$/);
testsContext.keys().forEach(key => {
  if (key.indexOf('/server/') < 0) { testsContext(key); }
});
