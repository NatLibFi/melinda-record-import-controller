import {promisify} from 'util';
import {createLogger, createWebhookOperator} from '@natlibfi/melinda-backend-commons';
import {createMongoBlobsOperator, createAmqpOperator, BLOB_STATE} from '@natlibfi/melinda-record-import-commons';
import {earliestMoment, testMoment} from './config.js';

const setTimeoutPromise = promisify(setTimeout);

export async function startApp({mongoUrl, amqpUrl, webhookUrl, mongoDatabaseAndCollections, pollTime}, amqplib, momentDate) {
  const logger = createLogger();
  logger.info('Starting Mongo cleaning, removing old blobs');
  const amqpOperator = await createAmqpOperator(amqplib, amqpUrl);
  const webhookOperator = createWebhookOperator(webhookUrl);

  await createSearchProcess(mongoDatabaseAndCollections);

  if (momentDate === testMoment) { // test escape
    return;
  }

  await amqpOperator.closeChannel();
  await amqpOperator.closeConnection();

  const pollTimeInHours = parseInt(pollTime, 10) / 1000 / 60 / 60;
  logger.info(pollTime ? `Done, await ${pollTimeInHours}h till next restart` : 'Done');
  await setTimeoutPromise(parseInt(pollTime, 10));
  logger.info('Restarting');
  return;

  async function createSearchProcess(configs) {
    const [config, ...rest] = configs;

    if (config === undefined) {
      logger.info('All configs processed');
      return;
    }

    const {db, collection, state, blobRemoveDaysFromNow = false} = config;
    const removeBlobDate = new Date(momentDate);
    removeBlobDate.setDate(removeBlobDate.getDate() - blobRemoveDaysFromNow);
    const removeBlobDateIso = new Date(removeBlobDate).toISOString();
    const mongoOperator = await createMongoBlobsOperator(mongoUrl, db);
    const params = generateParams(state, removeBlobDate);

    logger.info(`PROCESSING: Collection: '${collection}', state: '${state}'.Find blobs that have last modification older than: ${removeBlobDateIso}.`);
    await searchItemAndDelete(mongoOperator, params);

    logger.info(`DONE PROCESSING: Collection: '${collection}', state: '${state}'`);

    return createSearchProcess(rest);

    function generateParams(state, removeBlobDate) {
      const query = {
        state,
        modificationTime: `${new Date(earliestMoment).toISOString()},${new Date(removeBlobDate).toISOString()}`,
        limit: 100,
        getAll: false
      };

      // logger.debug(query.modificationTime);
      return query;
    }
  }

  async function searchItemAndDelete(mongoOperator, params) {
    // find and remove
    const blobsArray = [];
    await new Promise(async (resolve, reject) => {
      const emitter = await mongoOperator.queryBlob(params);
      emitter.on('blobs', blobs => {
        logger.info(`blobs has blobs: ${blobs.length}`);
        blobs.forEach(blob => {
          if (blob.state === params.state) {
            blobsArray.push(blob);
          }
        });
      })
        .on('error', error => reject(error))
        .on('end', async () => {
          await setTimeoutPromise(500); // To make sure all blobs get in to the array
          resolve();
        });
    });

    logger.info(`blobs to handle: ${blobsArray.length}`);
    const emptyBlobs = await pumpQueueStates(blobsArray);
    logger.info(`blobs OK to be removed: ${JSON.stringify(emptyBlobs)}`);
    await pumpBlobs(emptyBlobs);
    return;

    async function pumpBlobs(blobsArray) {
      const [blob, ...rest] = blobsArray;

      if (blob === undefined) {
        return;
      }

      //logger.debug(JSON.stringify(blob));
      const {id, profile, state, creationTime, modificationTime} = blob;
      logger.debug(`Processing blob: ${id}, profile: ${profile}, state: ${state}, created: ${creationTime}, modified: ${modificationTime}`);
      logger.debug(`Checking rabbit queues for ${id}.${state}`);
      logger.debug(`Removing blob content ${id}`);
      await mongoOperator.removeBlobContent({id});
      logger.debug('Removed blob files');
      await mongoOperator.removeBlob({id});
      logger.debug('Removed blob');

      return pumpBlobs(rest);
    }

    async function pumpQueueStates(blobsArray, handledBlobs = []) {
      const [blob, ...rest] = blobsArray;

      if (blob === undefined) {
        return handledBlobs;
      }
      let hasFailed = false;

      for (const state in BLOB_STATE) {
        try {
          await amqpOperator.deleteQueue({blobId: blob.id, status: state}, false);
        } catch (error) {
          logger.info(error.message);
          if (error.message === 'Trying to remove queue that has unhandled messages!') {
            webhookOperator.sendNotification(`Blob: ${blob.id} has messages in queue: ${state}.${blob.id}`);
            hasFailed = true;
            break;
          }
          throw error;
        }
      }

      if (hasFailed) {
        return pumpQueueStates(rest, handledBlobs);
      }

      return pumpQueueStates(rest, [...handledBlobs, blob]);
    }
  }
}
