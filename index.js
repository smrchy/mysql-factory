(function() {
  exports.version = '0.1.15';

  exports.getSqlBuilder = require('./lib/sql');

  exports.utils = require('./lib/utils');

  module.exports = require('./lib/factory');

}).call(this);
