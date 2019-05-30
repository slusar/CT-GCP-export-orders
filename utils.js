/* ===========================================================
# sphere-order-export - v2.2.3
# ==============================================================
# Copyright (c) 2014 Hajo Eichler
# Licensed under the MIT license.
*/
var ExtendedLogger, ProjectCredentialsConfig, _, fs, package_json, path, ref;

fs = require('fs-extra');

path = require('path');

_ = require('underscore');

ref = require('sphere-node-utils'), ExtendedLogger = ref.ExtendedLogger, ProjectCredentialsConfig = ref.ProjectCredentialsConfig;

package_json = require('./package');

exports.getDefaultOptions = function() {
  return require('optimist').usage('Usage: $0 --projectKey key --clientId id --clientSecret secret').describe('projectKey', 'your SPHERE.IO project-key').describe('clientId', 'your OAuth client id for the SPHERE.IO API').describe('clientSecret', 'your OAuth client secret for the SPHERE.IO API').describe('accessToken', 'an OAuth access token for the SPHERE.IO API').describe('sphereHost', 'SPHERE.IO API host to connect to').describe('sphereProtocol', 'SPHERE.IO API protocol to connect to').describe('sphereAuthHost', 'SPHERE.IO OAuth host to connect to').describe('sphereAuthProtocol', 'SPHERE.IO OAuth protocol to connect to').describe('perPage', 'Number of orders to be fetched per page').describe('targetDir', 'the folder where exported files are saved').describe('fileWithTimestamp', 'whether exported file should contain a timestamp').describe('where', 'where predicate used to filter orders exported. More info here http://dev.commercetools.com/http-api.html#predicates').describe('logLevel', 'log level for file logging').describe('logDir', 'directory to store logs').describe('timeout', 'Set timeout for requests')["default"]('perPage', 100)["default"]('targetDir', path.join(__dirname, '../exports'))["default"]('fileWithTimestamp', false)["default"]('logLevel', 'info')["default"]('logDir', '.')["default"]('timeout', 60000).demand(['projectKey']).string(['logDir']);
};

exports.getLogger = function(argv, name) {
  var logger;
  if (name == null) {
    name = package_json.name;
  }
  if (argv.logDir === '') {
    throw new Error('LogDir parameter has to have a value with folder path where to save a log file.');
  }
  if (argv.logDir !== '.') {
    fs.ensureDirSync(argv.logDir);
  }
  logger = new ExtendedLogger({
    additionalFields: {
      project_key: argv.projectKey
    },
    logConfig: {
      name: name + "-" + package_json.version,
      silent: Boolean(argv.logSilent),
      streams: [
        {
          level: argv.logLevel,
          stream: process.stdout
        }, {
          level: 'debug',
          path: argv.logDir + "/" + name + ".log"
        }
      ]
    }
  });
  return logger;
};

exports.ensureCredentials = function(argv) {
  if (argv.accessToken) {
    return Promise.resolve({
      config: {
        project_key: argv.projectKey
      },
      access_token: argv.accessToken
    });
  } else {
    return ProjectCredentialsConfig.create().then(function(credentials) {
      return {
        config: credentials.enrichCredentials({
          project_key: argv.projectKey,
          client_id: argv.clientId,
          client_secret: argv.clientSecret
        })
      };
    });
  }
};

exports.getClientOptions = function(credentials, argv) {
  var clientOptions;
  clientOptions = _.extend(credentials, {
    timeout: argv.timeout,
    user_agent: package_json.name + " - " + package_json.version
  });
  if (argv.sphereHost) {
    clientOptions.host = argv.sphereHost;
  }
  if (argv.sphereProtocol) {
    clientOptions.protocol = argv.sphereProtocol;
  }
  if (argv.sphereAuthHost) {
    clientOptions.oauth_host = argv.sphereAuthHost;
    clientOptions.rejectUnauthorized = false;
  }
  if (argv.sphereAuthProtocol) {
    clientOptions.oauth_protocol = argv.sphereAuthProtocol;
  }
  return clientOptions;
};

exports.getFileName = function(withTimestamp, prefix, ts) {
  if (ts == null) {
    ts = (new Date()).getTime();
  }
  if (withTimestamp) {
    return prefix + "_" + ts + ".csv";
  } else {
    return prefix + ".csv";
  }
};
