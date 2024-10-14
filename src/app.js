import {promisify} from 'util';
import {createLogger} from '@natlibfi/melinda-backend-commons';
import {earliestMoment, testMoment} from './config';
import {createMongoBlobsOperator} from '@natlibfi/melinda-record-import-commons';

const setTimeoutPromise = promisify(setTimeout);

export async function startApp({mongoUri, mongoDatabaseAndCollections, pollTime}, momentDate) {
  const logger = createLogger();
  logger.info('Starting Mongo cleaning, removing old blobs');

  await createSearchProcess(mongoDatabaseAndCollections);

  if (momentDate === testMoment) { // test escape
    return;
  }

  const pollTimeInHours = pollTime / 1000 / 60 / 60;
  logger.info(pollTime ? `Done, await ${pollTimeInHours}h till next restart` : 'Done');
  await setTimeoutPromise(pollTime);
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
    const mongoOperator = await createMongoBlobsOperator(mongoUri, db);

    logger.info(`PROCESSING: Collection: '${collection}', state: '${state}'.Find blobs that have last modification older than: ${removeBlobDateIso}.`);
    await searchItemAndDelete(mongoOperator, {
      collection,
      state,
      removeBlobDate
    });

    return createSearchProcess(rest);
  }

  async function searchItemAndDelete(mongoOperator, {collection, state, removeBlobDate}) {
    // find and remove
    const params = generateParams(state, removeBlobDate);
    const blobsArray = [];
    await new Promise((resolve, reject) => {
      const emitter = mongoOperator.queryBlob(params);
      emitter.on('blobs', blobs => blobs.forEach(blob => blobsArray.push(blob))) // eslint-disable-line functional/immutable-data
        .on('error', error => reject(error))
        .on('end', async () => {
          await setTimeoutPromise(5); // To make sure all blobs get in to the array
          resolve(blobsArray);
        });
    });

    if (blobsArray.length < 1) {
      logger.info(`DONE PROCESSING: Collection: '${collection}', state: '${state}'`);
      return;
    }

    const [blob] = blobsArray;

    logger.debug(JSON.stringify(blob));
    const {id, modificationTime} = blob;

    logger.debug(`Processing blob: ${id}, modified: ${modificationTime}`);
    await mongoOperator.removeBlobContent({id});
    logger.debug('Removed blob files');
    await mongoOperator.removeBlob({id});
    logger.debug('Removed blob');

    return searchItemAndDelete(mongoOperator, {collection, state, removeBlobDate});

    function generateParams(state, removeBlobDate) {
      const query = {
        state,
        modificationTime: `${new Date(earliestMoment).toISOString()},${new Date(removeBlobDate).toISOString()}`,
        limit: 1,
        getAll: false
      };

      // logger.debug(query.modificationTime);
      return query;

    }
  }
}
