/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* Controller microservice of Melinda record batch import system
*
* Copyright (C) 2018-2019 University Of Helsinki (The National Library Of Finland)
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

import moment from 'moment';
import amqplib from 'amqplib';
import HttpStatus from 'http-status';
import humanInterval from 'human-interval';
import {createLogger} from '@natlibfi/melinda-backend-commons';
import {BLOB_STATE, createApiClient, ApiError} from '@natlibfi/melinda-record-import-commons';
import {logError, processBlobs} from '../utils';

export default function (agenda, {
  terminateTasks, pruneTasks, listTasks,
  API_URL, API_USERNAME, API_PASSWORD, API_CLIENT_USER_AGENT, AMQP_URL,
  JOB_BLOBS_METADATA_CLEANUP, JOB_BLOBS_CONTENT_CLEANUP,
  JOB_BLOBS_MISSING_RECORDS, JOB_BLOBS_TRANSFORMATION_QUEUE_CLEANUP,
  JOB_PRUNE_TASKS, JOB_TASKS_HEALTH,
  BLOBS_METADATA_TTL, BLOBS_CONTENT_TTL, STALE_TRANSFORMATION_PROGRESS_TTL,
  JOB_BLOBS_TRANSFORMATION_FAILED_CLEANUP, JOB_BLOBS_PROCESSING_QUEUE_CLEANUP,
  TRANSFORMATION_FAILED_TTL, STALE_PROCESSING_PROGRESS_TTL
}) {
  const logger = createLogger();
  const client = createApiClient({
    url: API_URL, username: API_USERNAME, password: API_PASSWORD,
    userAgent: API_CLIENT_USER_AGENT
  });

  agenda.define(JOB_BLOBS_METADATA_CLEANUP, {}, blobsMetadataCleanup);
  agenda.define(JOB_BLOBS_CONTENT_CLEANUP, {}, blobsContentCleanup);
  agenda.define(JOB_BLOBS_MISSING_RECORDS, {}, blobsMissingRecords);
  agenda.define(JOB_PRUNE_TASKS, {}, pruneTasksJob);
  agenda.define(JOB_TASKS_HEALTH, {}, tasksHealth);
  agenda.define(JOB_BLOBS_TRANSFORMATION_QUEUE_CLEANUP, {}, blobsTransformationQueueCleanup);
  agenda.define(JOB_BLOBS_TRANSFORMATION_FAILED_CLEANUP, {}, blobsTransformationFailedQueueCleanup);
  agenda.define(JOB_BLOBS_PROCESSING_QUEUE_CLEANUP, {}, blobsProcessingQueueCleanup);

  function blobsMetadataCleanup(_, done) {
    return blobsCleanup({
      method: 'deleteBlob',
      ttl: humanInterval(BLOBS_METADATA_TTL),
      doneCallback: done,
      messageCallback: count => `${count} blobs need to be deleted.`,
      state: [BLOB_STATE.PROCESSED, BLOB_STATE.ABORTED]
    });
  }

  function blobsContentCleanup(_, done) {
    return blobsCleanup({
      method: 'deleteBlobContent',
      ttl: humanInterval(BLOBS_CONTENT_TTL),
      doneCallback: done,
      messageCallback: count => `${count} blobs need to have their content deleted.`,
      state: [BLOB_STATE.PROCESSED, BLOB_STATE.ABORTED]
    });
  }

  function blobsTransformationQueueCleanup(_, done) {
    return blobsCleanup({
      method: 'requeueBlob',
      ttl: humanInterval(STALE_TRANSFORMATION_PROGRESS_TTL),
      doneCallback: done,
      messageCallback: count => `${count} blobs need to be removed from the transformation queue`,
      state: [BLOB_STATE.TRANSFORMATION_IN_PROGRESS]
    });
  }

  function blobsTransformationFailedQueueCleanup(_, done) {
    return blobsCleanup({
      method: 'deleteBlob',
      ttl: humanInterval(TRANSFORMATION_FAILED_TTL),
      doneCallback: done,
      messageCallback: count => `${count} blobs has failed transformation and will be removed`,
      state: [BLOB_STATE.TRANSFORMATION_FAILED]
    });
  }

  function blobsProcessingQueueCleanup(_, done) {
    return blobsCleanup({
      method: 'abortBlob',
      ttl: humanInterval(STALE_PROCESSING_PROGRESS_TTL),
      doneCallback: done,
      messageCallback: count => `${count} blobs need to abort for restart`,
      state: [BLOB_STATE.PROCESSING]
    });
  }

  async function blobsMissingRecords(_, done) {
    let connection; // eslint-disable-line functional/no-let
    let channel; // eslint-disable-line functional/no-let

    try {
      connection = await amqplib.connect(AMQP_URL);
      channel = await connection.createChannel();

      await processBlobs({
        client, processCallback,
        query: {state: BLOB_STATE.TRANSFORMED}
      });
    } catch (err) {
      logError(err);
    } finally {
      if (channel) { // eslint-disable-line functional/no-conditional-statement
        await channel.close();
      }

      if (connection) { // eslint-disable-line functional/no-conditional-statement
        await connection.close();
      }

      done();
    }

    async function processCallback(blobs) {
      const [blob, ...rest] = blobs;

      if (blob) {
        const {id, processedRecords, failedRecords, numberOfRecords} = blob;
        const processedCount = processedRecords + failedRecords;
        const {messageCount} = await channel.assertQueue(id);

        if (processedCount < numberOfRecords && messageCount === 0) { // eslint-disable-line functional/no-conditional-statement
          logger.log('warn', `Blob ${id} is missing records from the queue (processedCount: ${processedCount}, numberOfRecords: ${numberOfRecords}, messageCount: ${messageCount})`);
        }

        return processCallback(rest);
      }
    }
  }

  async function blobsCleanup({method, ttl, doneCallback, messageCallback, state}) {
    let connection; // eslint-disable-line functional/no-let
    let channel; // eslint-disable-line functional/no-let

    try {
      connection = await amqplib.connect(AMQP_URL);
      channel = await connection.createChannel();

      await processBlobs({
        client, processCallback, messageCallback,
        query: {state},
        filter: blob => {
          const modificationTime = moment(blob.modificationTime);
          if (method === 'requeueBlob') {
            return moment().isAfter(modificationTime.add(ttl));
          }

          return modificationTime.add(ttl).isBefore(moment());
        }
      });
    } finally {
      if (channel) { // eslint-disable-line functional/no-conditional-statement
        await channel.close();
      }

      if (connection) { // eslint-disable-line functional/no-conditional-statement
        await connection.close();
      }

      doneCallback();
    }

    function processCallback(blobs) {
      return cleanup(blobs);

      async function cleanup(blobs) {
        const [blob, ...rest] = blobs;

        if (blob) { // eslint-disable-line functional/no-conditional-statement
          const {id} = blob;

          try {
            if (method === 'deleteBlob' || method === 'reQueueBlob') { // eslint-disable-line functional/no-conditional-statement
              await channel.deleteQueue(id);
            }

            if (method === 'requeueBlob') {
              const tasks = await listTasks({blob: id, type: 'transform'});

              if (tasks.length === 0) { // eslint-disable-line functional/no-conditional-statement
                logger.log('warn', `Blob ${id} has no transformer alive. Setting state to PENDING_TRANSFORMATION`);
                await client.updateState({id, state: BLOB_STATE.PENDING_TRANSFORMATION});
              }

              return cleanup(rest);
            }

            await client[method]({id});

            if (method !== 'requeueBlob') { // eslint-disable-line functional/no-conditional-statement
              await terminateTasks({blob: id});
            }

            return cleanup(rest);
          } catch (err) {
            if (err instanceof ApiError && err.status === HttpStatus.BAD_REQUEST && method === 'deleteBlob') {
              logger.log('warn', `Couldn't delete blob ${id} because content hasn't yet been deleted`);
              return cleanup(rest);
            }

            if (err instanceof ApiError && err.status === HttpStatus.NOT_FOUND) {
              if (method === 'deleteBlob' || method === 'deleteBlobContent') { // eslint-disable-line functional/no-conditional-statement
                logger.log('debug', `Blob ${id} or content already removed`);
                await client.deleteBlob({id});
              }

              return cleanup(rest);
            }

            logError(err);
            return cleanup(rest);
          }
        }
      }
    }
  }

  async function pruneTasksJob(_, done) {
    try {
      await pruneTasks();
    } finally {
      done();
    }
  }

  async function tasksHealth(_, done) {
    try {
      await terminateTasks({unhealthy: true});
    } finally {
      done();
    }
  }
}
