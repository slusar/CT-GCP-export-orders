/* ===========================================================
# sphere-order-export - v2.2.3
# ==============================================================
# Copyright (c) 2014 Hajo Eichler
# Licensed under the MIT license.
*/
var CHANNEL_KEY, OrderExport, ProjectCredentialsConfig, Promise, Sftp, _, argv, createSyncOrders, csv, ensureExportDir, exportCSVAsStream, fs, fsExistsAsync, logger, package_json, path, readJsonFromPath, ref, tmp, utils;

path = require('path');

_ = require('underscore');

Promise = require('bluebird');

fs = Promise.promisifyAll(require('fs'));

tmp = Promise.promisifyAll(require('tmp'));

ref = require('sphere-node-utils'), ProjectCredentialsConfig = ref.ProjectCredentialsConfig, Sftp = ref.Sftp;

package_json = require('../package.json');

OrderExport = require('./orderexport');

utils = require('./utils');

csv = require('csv-parser');

CHANNEL_KEY = 'OrderXmlFileExport';

argv = utils.getDefaultOptions().describe('standardShippingMethod', 'Allows to define the fallback shipping method name if order has none').describe('exportUnsyncedOnly', 'whether only unsynced orders will be exported or not').describe('useExportTmpDir', 'whether to use a system tmp folder to store exported files').describe('csvTemplate', 'CSV template to define the structure of the export').describe('createSyncActions', 'upload syncInfo update actions for orders exported (only supports sftp upload').describe('fileWithTimestamp', 'whether exported file should contain a timestamp').describe('sftpCredentials', 'the path to a JSON file where to read the credentials from').describe('sftpHost', 'the SFTP host (overwrite value in sftpCredentials JSON, if given)').describe('sftpUsername', 'the SFTP username (overwrite value in sftpCredentials JSON, if given)').describe('sftpPassword', 'the SFTP password (overwrite value in sftpCredentials JSON, if given)').describe('sftpTarget', 'path in the SFTP server to where to move the worked files').describe('sftpContinueOnProblems', 'ignore errors when processing a file and continue with the next one').describe('where', 'where predicate used to filter orders exported. More info here http://dev.commercetools.com/http-api.html#predicates').describe('fillAllRows', 'fill all rows').describe('exportCSVAsStream', 'Exports CSV as stream (to use for performance reasons)')["default"]('standardShippingMethod', 'None')["default"]('exportUnsyncedOnly', true)["default"]('useExportTmpDir', false)["default"]('createSyncActions', false)["default"]('sftpContinueOnProblems', false)["default"]('fillAllRows', false)["default"]('exportCSVAsStream', false).argv;

logger = utils.getLogger(argv);

process.on('SIGUSR2', function() {
  return logger.reopenFileStreams();
});

process.on('exit', (function(_this) {
  return function() {
    return process.exit(_this.exitCode);
  };
})(this));

tmp.setGracefulCleanup();

fsExistsAsync = function(path) {
  return new Promise(function(resolve, reject) {
    return fs.exists(path, function(exists) {
      if (exists) {
        return resolve(true);
      } else {
        return resolve(false);
      }
    });
  });
};

ensureExportDir = function() {
  var exportsPath;
  if (("" + argv.useExportTmpDir) === 'true') {
    return tmp.dirAsync({
      unsafeCleanup: true
    }).then(function(tmpDir) {
      return tmpDir[0];
    });
  } else {
    exportsPath = argv.targetDir;
    return fsExistsAsync(exportsPath).then(function(exists) {
      if (exists) {
        return Promise.resolve(exportsPath);
      } else {
        return fs.mkdirAsync(exportsPath).then(function() {
          return Promise.resolve(exportsPath);
        });
      }
    });
  }
};

readJsonFromPath = function(path) {
  if (!path) {
    return Promise.resolve({});
  }
  return fs.readFileAsync(path, {
    encoding: 'utf-8'
  }).then(function(content) {
    return Promise.resolve(JSON.parse(content));
  });
};

exportCSVAsStream = function(csvFile, orderExport) {
  return new Promise(function(resolve, reject) {
    var output;
    output = fs.createWriteStream(csvFile, {
      encoding: 'utf-8'
    });
    output.on('error', function(error) {
      return reject(error);
    });
    output.on('finish', function() {
      return resolve();
    });
    return orderExport.runCSVAndStreamToFile((function(_this) {
      return function(data) {
        process.stdout.write('.');
        output.write(data + "\n");
        return Promise.resolve();
      };
    })(this)).then(function() {
      process.stdout.write('\n');
      return output.end();
    })["catch"](function(e) {
      return reject(e);
    });
  });
};

createSyncOrders = function(fileName) {
  logger.debug("Creating order objects with sync Information");
  return new Promise(function(resolve, reject) {
    var orderNumberMap, orders;
    orders = [];
    orderNumberMap = {};
    return fs.createReadStream(fileName).pipe(csv()).on('data', function(data) {
      var order;
      if (data.orderNumber && !orderNumberMap[data.orderNumber]) {
        order = {
          orderNumber: data.orderNumber,
          syncInfo: [
            {
              externalId: fileName,
              channel: CHANNEL_KEY
            }
          ]
        };
        orders.push(order);
        return orderNumberMap[data.orderNumber] = true;
      }
    }).on('end', function() {
      logger.info("SyncInfo generated " + (JSON.stringify(orders)));
      return resolve(orders);
    }).on('error', function(err) {
      return reject(err);
    });
  });
};

utils.ensureCredentials(argv).then((function(_this) {
  return function(credentials) {
    var exportType, orderExport;
    exportType = argv.csvTemplate ? 'csv' : 'xml';
    orderExport = new OrderExport({
      client: utils.getClientOptions(credentials, argv),
      "export": {
        perPage: argv.perPage,
        standardShippingMethod: argv.standardShippingMethod,
        exportType: exportType,
        exportUnsyncedOnly: argv.exportUnsyncedOnly,
        csvTemplate: argv.csvTemplate,
        fillAllRows: argv.fillAllRows,
        where: argv.where
      }
    });
    return ensureExportDir().then(function(outputDir) {
      var csvFile, fileName;
      logger.debug("Created output dir at " + outputDir);
      _this.outputDir = outputDir;
      fileName = utils.getFileName(argv.fileWithTimestamp, 'orders');
      csvFile = _this.outputDir + "/" + fileName;
      if (argv.exportCSVAsStream) {
        logger.info("Exporting orders as a stream.");
        return exportCSVAsStream(csvFile, orderExport);
      } else {
        return orderExport.run().then(function(data) {
          var ts;
          _this.orderReferences = [];
          if (exportType.toLowerCase() === 'csv') {
            logger.info("Storing CSV export to '" + csvFile + "'.");
            _this.orderReferences.push({
              fileName: csvFile,
              entry: data
            });
            return fs.writeFileAsync(csvFile, data);
          } else {
            logger.info("Storing " + (_.size(data)) + " file(s) to '" + _this.outputDir + "'.");
            ts = (new Date()).getTime();
            return Promise.map(data, function(entry) {
              var content;
              content = entry.xml.end({
                pretty: true,
                indent: '  ',
                newline: '\n'
              });
              if (argv.fileWithTimestamp) {
                fileName = entry.id + "_" + ts + ".xml";
              } else {
                fileName = entry.id + ".xml";
              }
              _this.orderReferences.push({
                name: fileName,
                entry: entry
              });
              return fs.writeFileAsync(_this.outputDir + "/" + fileName, content);
            }, {
              concurrency: 10
            });
          }
        });
      }
    }).then(function() {
      var sftpCredentials, sftpHost, sftpPassword, sftpUsername;
      sftpCredentials = argv.sftpCredentials, sftpHost = argv.sftpHost, sftpUsername = argv.sftpUsername, sftpPassword = argv.sftpPassword;
      if (sftpCredentials || (sftpHost && sftpUsername && sftpPassword)) {
        return readJsonFromPath(sftpCredentials).then(function(credentials) {
          var host, password, projectSftpCredentials, ref1, sftpClient, sftpTarget, username;
          projectSftpCredentials = credentials[argv.projectKey] || {};
          ref1 = _.defaults(projectSftpCredentials, {
            host: sftpHost,
            username: sftpUsername,
            password: sftpPassword,
            sftpTarget: argv.sftpTarget
          }), host = ref1.host, username = ref1.username, password = ref1.password, sftpTarget = ref1.sftpTarget;
          if (!host) {
            throw new Error('Missing sftp host');
          }
          if (!username) {
            throw new Error('Missing sftp username');
          }
          if (!password) {
            throw new Error('Missing sftp password');
          }
          sftpClient = new Sftp({
            host: host,
            username: username,
            password: password,
            logger: logger
          });
          return sftpClient.openSftp().then(function(sftp) {
            return fs.readdirAsync(_this.outputDir).then(function(files) {
              var filesSkipped;
              logger.info("About to upload " + (_.size(files)) + " file(s) from " + _this.outputDir + " to " + sftpTarget);
              filesSkipped = 0;
              return Promise.map(files, function(filename) {
                logger.debug("Uploading " + _this.outputDir + "/" + filename);
                if (!orderExport.ordersExported) {
                  return Promise.resolve();
                }
                return sftpClient.safePutFile(sftp, _this.outputDir + "/" + filename, sftpTarget + "/" + filename).then(function() {
                  var xml;
                  if (exportType.toLowerCase() === 'csv' && argv.createSyncActions) {
                    return createSyncOrders(_this.orderReferences[0].fileName).then(function(orders) {
                      var ordersFileJSON, ts;
                      if (orders.length) {
                        if (argv.fileWithTimestamp) {
                          ts = (new Date()).getTime();
                          ordersFileJSON = "orders_sync_" + ts + ".json";
                        } else {
                          ordersFileJSON = 'orders_sync.json';
                        }
                        return fs.writeFileAsync(_this.outputDir + "/" + ordersFileJSON, JSON.stringify(orders, null, 2)).then(function() {
                          logger.debug("Uploading " + _this.outputDir + "/" + ordersFileJSON);
                          return sftpClient.safePutFile(sftp, _this.outputDir + "/" + ordersFileJSON, sftpTarget + "/" + ordersFileJSON);
                        });
                      } else {
                        logger.debug("No orders: " + (JSON.stringify(orders, null, 2)) + " exported, no orders sync action to be set.");
                        return Promise.resolve();
                      }
                    });
                  } else {
                    xml = _.find(_this.orderReferences, function(r) {
                      return r.name === filename;
                    });
                    if (xml) {
                      logger.debug("About to sync order " + filename);
                      return orderExport.syncOrder(xml.entry, filename);
                    } else {
                      logger.warn("Not able to create syncInfo for " + filename + " as xml for that file was not found");
                      return Promise.resolve();
                    }
                  }
                })["catch"](function(err) {
                  if (argv.sftpContinueOnProblems) {
                    filesSkipped++;
                    logger.warn(err, "There was an error processing the file " + file + ", skipping and continue");
                    return Promise.resolve();
                  } else {
                    return Promise.reject(err);
                  }
                });
              }, {
                concurrency: 1
              }).then(function() {
                var totFiles;
                totFiles = _.size(files);
                if (totFiles > 0) {
                  logger.info("Export to SFTP successfully finished: " + (totFiles - filesSkipped) + " out of " + totFiles + " files were processed");
                } else {
                  logger.info("Export successfully finished: there were no new files to be processed");
                }
                sftpClient.close(sftp);
                return Promise.resolve();
              });
            })["finally"](function() {
              return sftpClient.close(sftp);
            });
          })["catch"](function(err) {
            logger.error(err, 'There was an error uploading the files to SFTP');
            return _this.exitCode = 1;
          });
        })["catch"](function(err) {
          logger.error(err, "Problems on getting sftp credentials from config files for project " + argv.projectKey + ".");
          return _this.exitCode = 1;
        });
      } else {
        return Promise.resolve();
      }
    }).then(function() {
      logger.info('Orders export complete');
      return _this.exitCode = 0;
    })["catch"](function(error) {
      logger.error(error, 'Oops, something went wrong!');
      return _this.exitCode = 1;
    });
  };
})(this))["catch"]((function(_this) {
  return function(err) {
    logger.error(err, 'Problems on getting client credentials from config files.');
    return _this.exitCode = 1;
  };
})(this));
