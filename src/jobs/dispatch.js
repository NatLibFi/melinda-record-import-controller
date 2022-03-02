/**

*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* Controller microservice of Melinda record batch import system
*
* Copyright (C) 2018-2021 University Of Helsinki (The National Library Of Finland)
*
* This file is part of melinda-record-import-controller
*
* melinda-record-import-controller program is free software: you can redistribute it and/or modify
* it under the terms of the GNU Affero General Public License as
* published by the Free Software Foundation, either version 3 of the
* License, or (at your option) any later version.
*
* melinda-record-import-controller is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU Affero General Public License for more details.
*
* You should have received a copy of the GNU Affero General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
*
* @licend  The above is the entire license notice
* for the JavaScript code in this file.
*
*/

import {createLogger} from '@natlibfi/melinda-backend-commons';
import {BLOB_STATE, createApiClient} from '@natlibfi/melinda-record-import-commons';
<<<<<<< HEAD
import {logError, processBlobs} from '../utils';
=======
import {logError, processBlobs, isOfflinePeriod} from '../utils';
>>>>>>> origin/next

export default function (agenda, {
  listTasks, dispatchTask, terminateTasks,
  API_URL, API_USERNAME, API_PASSWORD,
<<<<<<< HEAD
  JOB_BLOBS_PENDING, JOB_BLOBS_ABORTED,
  TASK_CONCURRENCY, TRANSFORMER_CONCURRENCY,
  JOB_BLOBS_PROCESSING, API_CLIENT_USER_AGENT
=======
  JOB_BLOBS_PENDING, JOB_BLOBS_TRANSFORMED, JOB_BLOBS_ABORTED,
  TASK_CONCURRENCY, IMPORTER_CONCURRENCY, TRANSFORMER_CONCURRENCY,
  IMPORTER_CONCURRENCY_BLOB, JOB_BLOBS_PROCESSING,
  API_CLIENT_USER_AGENT, IMPORT_OFFLINE_PERIOD
>>>>>>> origin/next
}) {
  const logger = createLogger();
  const client = createApiClient({
    url: API_URL, username: API_USERNAME, password: API_PASSWORD,
    userAgent: API_CLIENT_USER_AGENT
  });

  agenda.define(JOB_BLOBS_PENDING, {}, blobsPending);
  agenda.define(JOB_BLOBS_PROCESSING, {}, blobsProcessing);
<<<<<<< HEAD
=======
  agenda.define(JOB_BLOBS_TRANSFORMED, {}, blobsTransformed);
>>>>>>> origin/next
  agenda.define(JOB_BLOBS_ABORTED, {}, blobsAborted);

  async function blobsPending(_, done) {
    try {
      await processBlobs({
        client, processCallback,
        query: {state: BLOB_STATE.PENDING_TRANSFORMATION},
        messageCallback: count => `${count} blobs are pending transformation`
      });
    } finally {
      done();
    }

    function processCallback(blobs) {
      const profileCache = {};

      return dispatch(blobs);

      async function dispatch(blobs) {
        const [blob, ...rest] = blobs;

        if (blob === undefined) {
          logger.verbose('Dispatch DONE');
          return;
        }

        const {id, profile: profileId} = blob;
        try {
          const {transformation: transformationOptions} = await getProfile(profileId, profileCache);

          if (await canDispatch()) {
            await dispatchTask({
              type: 'transform',
              blob: id,
              profile: profileId,
              options: transformationOptions
            });

            await client.updateState({id, state: BLOB_STATE.TRANSFORMATION_IN_PROGRESS});
            logger.info(`Transformation started for ${id} `);

            return dispatch({blobs: rest});
          }

          logger.warn(`Could not dispatch transformer for blob ${id} because total number of tasks is exhausted`);
          return dispatch({blobs: rest});
        } catch (err) {
          logError(err);
        }

        async function canDispatch() {
          const totalCount = (await listTasks()).length;
          const transformCount = (await listTasks({type: 'transform'})).length;

          return transformCount < TRANSFORMER_CONCURRENCY && totalCount < TASK_CONCURRENCY;
        }
      }
    }
  }

  async function blobsProcessing(_, done) {
    logger.debug('Checking blobs in processing');

    try {
      await processBlobs({
        client, processCallback,
<<<<<<< HEAD
        query: {state: BLOB_STATE.PROCESSING_BULK},
=======
        query: {state: BLOB_STATE.PROCESSING},
>>>>>>> origin/next
        messageCallback: count => `${count} blobs are in process to be imported`
      });
    } catch (err) {
      logError(err);
    } finally {
      done();
    }

    async function processCallback(blobs) {
      await doProcessing(blobs);

      async function doProcessing(blobs) {
        const [blob, ...rest] = blobs;

        if (blob === undefined) {
          return;
        }

        const {numberOfRecords, processedRecords, failedRecords, id} = blob;

        if (numberOfRecords === processedRecords + failedRecords) {
          logger.debug(`All records of blob ${id} have been processed. Setting state to PROCESSED`);
          await client.updateState({id, state: BLOB_STATE.PROCESSED});
          return doProcessing(rest);
        }

<<<<<<< HEAD
=======
        const tasks = await listTasks({blob: id, type: 'import'});

        if (tasks.length === 0) { // eslint-disable-line functional/no-conditional-statement
          logger.warn(`Blob ${id} has no importer alive. Setting state to TRANSFORMED to get new importer`);
          await client.updateState({id, state: BLOB_STATE.TRANSFORMED});
          return doProcessing(rest);
        }

>>>>>>> origin/next
        return doProcessing(rest);
      }
    }
  }

<<<<<<< HEAD
=======
  async function blobsTransformed({attrs: {data: blobsTryCount}}, done) {
    const profileCache = {};

    try {
      await processBlobs({
        client, processCallback,
        query: {state: BLOB_STATE.TRANSFORMED},
        messageCallback: count => `${count} blobs have records waiting to be imported`
      });
    } catch (err) {
      logError(err);
    } finally {
      done();
    }

    async function processCallback(blobs) {
      Object.keys(blobsTryCount).forEach(({id}) => {
        if (blobs.some(({id: otherId}) => otherId === id)) {
          return;
        }

        delete blobsTryCount[id]; // eslint-disable-line functional/immutable-data
      });

      await doProcessing({blobs});

      async function doProcessing({blobs, profilesExhausted = []}) {
        const [blob, ...rest] = blobs;

        if (blob === undefined) {
          logger.debug('All blobs checked');
          return;
        }

        const {id, profile: profileId} = blob;

        if (profilesExhausted.includes(profileId)) {
          return doProcessing({blobs: rest, profilesExhausted});
        }

        const profile = await getProfile(profileId, profileCache);
        const {dispatchCount, canDispatchMore} = await getDispatchCount(profile.id);

        logger.debug(`Importer task status for profile ${id}: Can dispatch ${dispatchCount}. Can dispatch more: ${canDispatchMore}`);

        if (dispatchCount > 0) {
          if (isOfflinePeriod(IMPORT_OFFLINE_PERIOD)) {
            logger.debug('Not dispatching importers during offline period');
            return;
          }

          logger.debug(`Dispatching ${dispatchCount} import tasks for blob ${id}`);
          await dispatchImporters({id, dispatchCount, profile});
          await client.updateState({id, state: BLOB_STATE.PROCESSING});

          blobsTryCount[id] = blobsTryCount[id] ? blobsTryCount[id] + 1 : 1; // eslint-disable-line functional/immutable-data

          if (canDispatchMore === false) {
            logger.debug('Not processing further blobs because total task limit is exhausted');
            return;
          }

          return doProcessing({blobs: rest, profilesExhausted});
        }

        logger.debug(`Cannot dispatch importer tasks for blob ${id}. Maximum number of tasks exhausted.`);
        profilesExhausted.push(profileId); // eslint-disable-line functional/immutable-data

        return doProcessing({blobs: rest, profilesExhausted});

        async function getDispatchCount(id) {
          logger.info('Get dispatch count');
          const totalCount = (await listTasks()).length;
          const importerCount = (await listTasks({type: 'import'})).length;
          const blobImporterCount = (await listTasks({type: 'import', profile: id})).length;

          if (blobImporterCount < IMPORTER_CONCURRENCY_BLOB && importerCount < IMPORTER_CONCURRENCY && totalCount < TASK_CONCURRENCY) {
            const dispatchCount = calculateCount(totalCount, importerCount, blobImporterCount);
            const canDispatchMore = dispatchCount < IMPORTER_CONCURRENCY_BLOB && dispatchCount < IMPORTER_CONCURRENCY && dispatchCount < TASK_CONCURRENCY;

            return {dispatchCount, canDispatchMore};
          }

          return {dispatchCount: 0, canDispatchMore: false};

          function calculateCount() {
            const leftTotal = TASK_CONCURRENCY - totalCount;
            const leftImporters = IMPORTER_CONCURRENCY - importerCount;
            const leftBlobImporters = IMPORTER_CONCURRENCY_BLOB - blobImporterCount;

            const importerLimit = getImporterLimit();
            const totalResult = importerLimit - leftTotal;

            if (totalResult <= 0) {
              return importerLimit;
            }

            return 1;

            function getImporterLimit() {
              const limit = leftBlobImporters - leftImporters;

              if (limit <= 0) {
                return leftBlobImporters;
              }

              return 1;
            }
          }
        }

        function dispatchImporters({id, dispatchCount, profile}) {
          return Promise.all(map(async () => {
            try {
              await dispatchTask({
                type: 'import',
                blob: id,
                profile: profile.id,
                options: profile.import
              });
            } catch (err) {
              logError(err);
            }
          }));

          function map(cb) {
            return new Array(dispatchCount).fill(0).map(cb);
          }
        }
      }
    }
  }

>>>>>>> origin/next
  async function blobsAborted(_, done) {
    try {
      await processBlobs({
        client, processCallback,
        query: {state: BLOB_STATE.ABORTED}
      });
    } finally {
      done();
    }

    function processCallback(blobs) {
      return Promise.all(blobs.map(async ({id}) => {
        try {
          await terminateTasks({blob: id});
        } catch (err) {
          logError(err);
        }
      }));
    }
  }

  async function getProfile(id, cache) {
    if (id in cache) {
      return cache[id];
    }

    cache[id] = await client.getProfile({id}); // eslint-disable-line require-atomic-updates, functional/immutable-data
    return cache[id];
  }
}
