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
import {logError, processBlobs} from '../utils';

export default function (agenda, {
  listTasks, dispatchTask, terminateTasks,
  API_URL, API_USERNAME, API_PASSWORD,
  JOB_BLOBS_PENDING, JOB_BLOBS_ABORTED,
  TASK_CONCURRENCY, TRANSFORMER_CONCURRENCY,
  JOB_BLOBS_PROCESSING, API_CLIENT_USER_AGENT
}) {
  const logger = createLogger();
  const client = createApiClient({
    url: API_URL, username: API_USERNAME, password: API_PASSWORD,
    userAgent: API_CLIENT_USER_AGENT
  });

  agenda.define(JOB_BLOBS_PENDING, {}, blobsPending);
  agenda.define(JOB_BLOBS_PROCESSING, {}, blobsProcessing);
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
        query: {state: BLOB_STATE.PROCESSING_BULK},
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

        return doProcessing(rest);
      }
    }
  }

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
