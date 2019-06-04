const winston = require('winston');
const {LoggingWinston} = require('@google-cloud/logging-winston')
const {Storage} = require('@google-cloud/storage');
const Export = require('sphere-order-export/lib/orderexport');
const Rest = require('sphere-node-sdk/lib/connect/rest');
const ChannelService = require('sphere-node-sdk/lib/services/channels');
const OrderService = require('sphere-node-sdk/lib/services/orders');
const StatesService = require('sphere-node-sdk/lib/services/states');
const TaskQueue = require('sphere-node-sdk/lib/task-queue');
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

//for local node run
// const CT_PROJECT_KEY = process.env.npm_config_CONFIG_CT_PROJECT_KEY;
// const CT_CLIENT_ID = process.env.npm_config_CONFIG_CT_CLIENT_ID;
// const CT_CLIENT_SECRET = process.env.npm_config_CONFIG_CT_CLIENT_SECRET;
// const CT_CSV_TEMPLATE = process.env.npm_config_CONFIG_CT_CSV_TEMPLATE || '/usr/src/app/template/exported-orders-template.csv';
// const CT_FILL_ALL_ROWS = process.env.npm_config_CONFIG_CT_FILL_ALL_ROWS || false;
// const GCS_SERVICE_ACCOUNT_FILE = process.env.npm_config_CONFIG_GCS_SERVICE_ACCOUNT_FILE || '/config/gcs_sa.json';
// const GCS_TARGET_BUCKET_NAME = process.env.npm_config_CONFIG_GCS_TARGET_BUCKET_NAME;
// const GCS_TARGET_PATH_NAME = process.env.npm_config_CONFIG_GCS_TARGET_PATH_NAME;

//for docker run
const CT_PROJECT_KEY = process.env.CONFIG_CT_PROJECT_KEY;
const CT_CLIENT_ID = process.env.CONFIG_CT_CLIENT_ID;
const CT_CLIENT_SECRET = process.env.CONFIG_CT_CLIENT_SECRET;
const CT_CSV_TEMPLATE = process.env.CONFIG_CT_CSV_TEMPLATE || '/usr/src/app/template/exported-orders-template.csv';
const CT_FILL_ALL_ROWS = process.env.CONFIG_CT_FILL_ALL_ROWS || false;
const GCS_SERVICE_ACCOUNT_FILE = process.env.CONFIG_GCS_SERVICE_ACCOUNT_FILE || '/config/gcs_sa.json';
const GCS_TARGET_BUCKET_NAME = process.env.CONFIG_GCS_TARGET_BUCKET_NAME;
const GCS_TARGET_PATH_NAME = process.env.CONFIG_GCS_TARGET_PATH_NAME;
//

const configJson = {
    project_key: CT_PROJECT_KEY,
    client_id: CT_CLIENT_ID,
    client_secret: CT_CLIENT_SECRET
}
const statsJson = {
    includeHeaders: false,
    maskSensitiveHeaderData: false
}

const options = {
    client: {
        config: configJson
    },
    export: {
        exportType: 'csv',
        exportUnsyncedOnly: true,
        csvTemplate: CT_CSV_TEMPLATE,
        fillAllRows: CT_FILL_ALL_ROWS,
    }
}

const rest = new Rest({
    config: configJson
});


function getChannelService() {

    return new ChannelService({
        _rest: rest, _task: new TaskQueue, _stats: statsJson
    });
}

function getStatesService() {

    return new StatesService({
        _rest: rest, _task: new TaskQueue, _stats: statsJson
    });
}

function getOrderService() {
    return new OrderService({
        _rest: rest, _task: new TaskQueue, _stats: statsJson
    });
}

var main = (async function () {
    logger.info('start');

    logConfiguration(logger);

    process.env.GOOGLE_APPLICATION_CREDENTIALS = GCS_SERVICE_ACCOUNT_FILE;

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
                    logger.info("file was written to bucket " + GCS_TARGET_BUCKET_NAME);
                    return resolve(processOrderUpdate(filename));
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
        let filename = GCS_TARGET_PATH_NAME + '/' + targetFilename;
        return filename;
    }

    async function fetchChannelId(cs) {
        return await cs.byQueryString("where=key=\"" + CHANNEL_KEY + "\"").fetch().then(function (data) {
            if (data.body.total == 0) {
                logger.info(`no channel found for key ${CHANNEL_KEY}`);
                throw new Error(`no channel found for key ${CHANNEL_KEY}`);
            }
            logger.info(`found chanel ${data.body.results[0].id}`);
            return data.body.results[0].id;
        }).catch(function (e) {
            logger.error('error fetching');
            logger.error(e);
            throw e;
        });
    }

    async function fetchOrder(os, orderNumber) {

        return await os.byQueryString("where=orderNumber=\"" + orderNumber + "\"").fetch().then(function (data) {
            if (data.body.total == 0) {
                logger.info(`no order found for number ${orderNumber}`);
                throw new Error(`no order found for number ${orderNumber}`);
            }
            logger.info(`found order ${data.body.results[0].id}`);
            return data.body.results[0];
        }).catch(function (e) {
            logger.error('error fetching');
            logger.error(e);
            throw e;
        });
    }

    async function fetchStateId(cs, stateName) {

        return await cs.byQueryString("where=key=\"" + stateName + "\"").fetch().then(function (data) {
            if (data.body.total == 0) {
                logger.info(`no state found for key ${stateName}`);
                throw new Error(`no state found for key ${stateName}`);
            }
            logger.info(`found state ${data.body.results[0].id}`);
            return data.body.results[0].id;
        }).catch(function (e) {
            logger.error('error fetching');
            throw e;
        });
    }

    function processOrderUpdate(filename) {

        return new Promise(function (resolve, reject) {
            logger.info("About to sync order " + filename);
            try {
                logger.info("Processing sync information");
                return createSyncOrders(getTargetFileNameWithLocation(filename)).then(async function (orders) {

                    if (orders.length) {
                        logger.info(`syncing ${orders.length} orders`);
                        let os = getOrderService();
                        const channelId = await fetchChannelId(getChannelService());
                        const newStateId = await fetchStateId(getStatesService(), 'exported');

                        for (const ord of orders) {
                            await processOrder(os, ord, channelId, newStateId);
                        }
                    } else {
                        logger.info("No orders exported, no orders sync action to be set.");
                    }
                });
            } catch (e) {
                logger.error(e);
                reject(e);
            }
            resolve();
        });

        function createSyncInfoUpdateAction(ver, channelId) {
            return {
                version: ver,
                actions: [
                    {
                        action: 'updateSyncInfo',
                        channel: {
                            typeId: 'channel',
                            id: channelId
                        }
                    }
                ]
            }
        }

        function createUpdateItemsStatesUpdateAction(items, newStateId, orderVersion) {
            let item_actions = [];
            for (const item of items) {
                for (const stateObj of item['state']) {
                    let action = {
                        action: 'transitionLineItemState',
                        lineItemId: item['id'],
                        quantity: stateObj['quantity'],
                        fromState: stateObj['state'],
                        toState: {
                            typeId: 'state',
                            id: newStateId
                        }
                    }
                    item_actions.push(action);
                }
            }
            return {
                version: orderVersion,
                actions: item_actions
            }
        }

        async function updateOrder(orderId, update_action, os) {
            logger.info(`sending order ${orderId} update ${JSON.stringify(update_action, null, 2)}`);
            // updating order
            await os.byId(orderId).update(update_action).then(function (result) {
                if (result.statusCode != 200) {
                    logger.error(result.message);
                    throw new Error(result.message);
                }
                logger.info(`update of order ${orderId} complete`);
                return result.body;
            }).catch(function (e) {
                logger.error(e);
                throw e;
            });
        }

        async function processOrder(os, ord, channelId, newStateId) {
            try {
                let order = await fetchOrder(os, ord.orderNumber);
                let version = order['version'];
                let update_action = createSyncInfoUpdateAction(version++, channelId);
                //updating object fo current version
                await updateOrder(order['id'], update_action, os).then(async function () {
                    const items = order['lineItems'];
                    update_action = createUpdateItemsStatesUpdateAction(items, newStateId, version);
                    await updateOrder(order['id'], update_action, os);
                });
            } catch (e) {
                logger.error(e);
                throw e;
            }
        }
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
    return storage.bucket(GCS_TARGET_BUCKET_NAME);
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
        CONFIG_CT_PROJECT_KEY: CT_PROJECT_KEY,
        CONFIG_CT_CLIENT_ID: CT_CLIENT_ID ? "(present)" : "(missing)",
        CONFIG_CT_CLIENT_SECRET: CT_CLIENT_SECRET ? "(present)" : "(missing)",
        CONFIG_CT_CSV_TEMPLATE: CT_CSV_TEMPLATE,
        CONFIG_CT_FILL_ALL_ROWS: CT_FILL_ALL_ROWS,
        CONFIG_GCS_SERVICE_ACCOUNT_FILE: GCS_SERVICE_ACCOUNT_FILE,
        CONFIG_GCS_TARGET_BUCKET_NAME: GCS_TARGET_BUCKET_NAME,
        CONFIG_GCS_TARGET_PATH_NAME: GCS_TARGET_PATH_NAME,
    };
    logger.info(config);
}
