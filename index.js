const winston = require('winston');
const {LoggingWinston} = require('@google-cloud/logging-winston')
const {Storage} = require('@google-cloud/storage');
const Export = require('sphere-order-export/lib/orderexport')
const loggingWinston = new LoggingWinston();

const logger = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.Console(),
        // Add Stackdriver Logging
        loggingWinston,
    ]
});
const csv = require('csv-parser');
const CHANNEL_KEY = 'OrderXmlFileExport';

const options = {
    client: {
        config: {
            project_key: process.env.CONFIG_CT_PROJECT_KEY,
            client_id: process.env.CONFIG_CT_CLIENT_ID,
            client_secret: process.env.CONFIG_CT_CLIENT_SECRET
        }
    },
    export: {
        exportType: 'csv',
        exportUnsyncedOnly: true,
        csvTemplate: process.env.CONFIG_CT_CSV_TEMPLATE,
        fillAllRows: process.env.CONFIG_CT_FILL_ALL_ROWS || false,
    }
}

var main = (async function () {
    logger.info('start');

    logConfiguration(logger);

    process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.CONFIG_GCS_SERVICE_ACCOUNT_FILE;

    let filename = getTargetFileName();

    const exportOrder = new Export(options);
    await new Promise(function (resolve, reject) {
        try {
            logger.info("Exporting orders.");
            exportOrder.run().then(async function (data) {
                logger.info("file size is : " + data.length);

                if (!exportOrder.ordersExported) {
                    logger.info("No orders found. Nothing was exported");
                    return Promise.resolve();
                }
                writeFileToBucket(data, getTargetFileNameWithLocation(filename)).then(function () {
                    logger.info("file was written to bucket " + process.env.CONFIG_GCS_TARGET_BUCKET_NAME);
                    return resolve(syncInfo(filename));
                }).catch(function (error) {
                    logger.error(error);
                    reject(error);
                });
            }).catch(function (error) {
                logger.error(error);
                reject(error);
            });
        } catch (e) {
            logger.error(e);
            reject(e);
        }
    }).then(function () {
        logger.info(`order export finished.`);
    });

    function getTargetFileName() {
        let filename = 'order_export_' + (new Date().getTime()) + '.csv';
        return filename;
    }

    function getTargetFileNameWithLocation(targetFilename) {
        let filename = process.env.CONFIG_GCS_TARGET_PATH_NAME + '/' + targetFilename;
        return filename;
    }

    function syncInfo(filename) {

        function getJsonFileName() {
            let ordersFileJSON;
            if (process.env.CONFIG_CT_FILE_WITH_TIMESTAMP) {
                ordersFileJSON = "orders_sync_" + (new Date()).getTime() + ".json";
            } else {
                ordersFileJSON = 'orders_sync.json';
            }
            return ordersFileJSON;
        }

        logger.info("About to sync order " + filename);

        return new Promise(function (resolve, reject) {
            if (process.env.CONFIG_CT_CREATE_SYNC_ACTIONS) {
                try {
                    logger.info("Creating sync actions");
                    return createSyncOrders(getTargetFileNameWithLocation(filename)).then(async function (orders) {
                        if (orders.length) {
                            await writeFileToBucket(JSON.stringify(orders, null, 2), getTargetFileNameWithLocation(getJsonFileName())).then(function () {
                                logger.info("File was written to bucket " + process.env.CONFIG_GCS_TARGET_BUCKET_NAME);
                                return resolve();
                            }).catch(function (e) {
                                logger.error(e);
                                reject(e);
                            });
                        } else {
                            logger.info("No orders exported, no orders sync action to be set.");
                        }
                    });
                } catch (e) {
                    logger.error(e);
                    reject(e);
                }
                resolve();
            } else {
                logger.info("Sync actions not created");
            }
        });
    }

})
();

function writeFileToBucket(data, filename) {
    logger.info(`writing file ${filename} to bucket. file length is ${data.length}`);
    return new Promise(function (resolve, reject) {
        const bucket = getBucket();
        try {
            const file = bucket.file(filename);

            return file.save(data, function (err) {
                if (!err) {
                    // File written successfully.
                    logger.info(`Successfully saved bucket file ${filename}`);
                    return resolve();
                } else {
                    logger.error(err);
                    return reject(err);
                }
            });
        } catch (e) {
            logger.error(e);
            return reject(e);
        }
    });
}

function getBucket() {
    const storage = new Storage();
    const bucket = storage.bucket(process.env.CONFIG_GCS_TARGET_BUCKET_NAME);
    return bucket;
}

function createSyncOrders(fileName) {
    logger.info("Creating order objects with sync information");
    var orderNumberMap, orders;
    orders = [];
    orderNumberMap = {};
    return new Promise(async function (resolve, reject) {
        const bucket = getBucket();
        return await bucket.file(fileName).createReadStream().pipe(csv()).on('data', function (data) {
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
        }).on('end', function () {
            logger.info("SyncInfo generated");
            return resolve(orders);
        }).on('error', function (err) {
            return reject(err);
        });
    });
};

function logConfiguration(logger) {
    const config = {
        CONFIG_CT_PROJECT_KEY: process.env.CONFIG_CT_PROJECT_KEY,
        CONFIG_CT_CLIENT_ID: process.env.CONFIG_CT_CLIENT_ID ? "(present)" : "(missing)",
        CONFIG_CT_CLIENT_SECRET: process.env.CONFIG_CT_CLIENT_SECRET ? "(present)" : "(missing)",
        CONFIG_GCS_SERVICE_ACCOUNT_FILE: process.env.CONFIG_GCS_SERVICE_ACCOUNT_FILE,
        CONFIG_GCS_TARGET_BUCKET_NAME: process.env.CONFIG_GCS_TARGET_BUCKET_NAME,
        CONFIG_GCS_TARGET_PATH_NAME: process.env.CONFIG_GCS_TARGET_PATH_NAME,
        CONFIG_CT_CSV_TEMPLATE: process.env.CONFIG_CT_CSV_TEMPLATE,
        CONFIG_CT_FILL_ALL_ROWS: process.env.CONFIG_CT_FILL_ALL_ROWS,
        CONFIG_CT_CREATE_SYNC_ACTIONS: process.env.CONFIG_CT_CREATE_SYNC_ACTIONS,
        CONFIG_CT_FILE_WITH_TIMESTAMP: process.env.CONFIG_CT_FILE_WITH_TIMESTAMP,
    };
    logger.info(config);
}
