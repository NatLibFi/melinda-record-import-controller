import {promisify} from 'util';
import {MongoClient} from 'mongodb';
import {createLogger} from '@natlibfi/melinda-backend-commons';
import {earliestMoment, testMoment} from './config';

const setTimeoutPromise = promisify(setTimeout);

export async function startApp({mongoUri, mongoDatabaseAndCollections, pollTime}, momentDate) {
  const logger = createLogger();
  logger.info('Starting Mongo cleaning, removing old blobs');
  const client = await MongoClient.connect(mongoUri, {useNewUrlParser: true, useUnifiedTopology: true});

  await createSearchProcess(mongoDatabaseAndCollections);

  await client.close();
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

    const {db, collection, state, blobRemoveDaysFromNow = false, test = false} = config;
    const removeBlobDate = new Date(momentDate);
    removeBlobDate.setDate(removeBlobDate.getDate() - blobRemoveDaysFromNow);
    const removeBlobDateIso = new Date(removeBlobDate).toISOString();

    const mongoOperator = db === '' ? client.db() : client.db(db);
    logger.info(`PROCESSING: Collection: '${collection}', state: '${state}'.Find blobs that have last modification older than: ${removeBlobDateIso}.`);
    await searchItemAndDelete(mongoOperator, {
      collection,
      state,
      removeBlobDate,
      test
    });

    return createSearchProcess(rest);
  }

  async function searchItemAndDelete(mongoOperator, {collection, state, removeBlobDate, test}) {
    // find and remove
    const params = generateParams(state, removeBlobDate, test);
    const blob = await mongoOperator.collection(collection).findOne(params);

    if (blob === null) {
      logger.info(`DONE PROCESSING: Collection: '${collection}', state: '${state}'`);
      return;
    }

    const {id, modificationTime} = blob;
    logger.debug(`Processing blob: ${id}, modified: ${modificationTime}`);

    const deleteResult = await mongoOperator.collection('blobs.files').deleteMany({filename: id});
    logger.debug(`Removed blob file: ${deleteResult.deletedCount ? 'true' : 'false'}`);


    await mongoOperator.collection(collection).deleteMany({id});

    return searchItemAndDelete(mongoOperator, {collection, state, removeBlobDate, test});

    function generateParams(state, removeBlobDate, test) {
      const query = {
        state,
        'modificationTime': {
          '$gte': test ? new Date(earliestMoment).toISOString() : new Date(earliestMoment),
          '$lte': test ? new Date(removeBlobDate).toISOString() : new Date(removeBlobDate)
        }
      };

      return query;

    }
  }
}
