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

import moment from 'moment';
import amqplib from 'amqplib';
import HttpStatus from 'http-status';
import humanInterval from 'human-interval';
import {createLogger} from '@natlibfi/melinda-backend-commons';
import {Error as ApiError} from '@natlibfi/melinda-commons';
import {BLOB_STATE, createApiClient} from '@natlibfi/melinda-record-import-commons';
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
    recordImportApiUrl: API_URL, recordImportApiUsername: API_USERNAME,
    recordImportApiPassword: API_PASSWORD, userAgent: API_CLIENT_USER_AGENT
  });

  agenda.define(JOB_BLOBS_METADATA_CLEANUP, {}, blobsMetadataCleanup);
  agenda.define(JOB_BLOBS_CONTENT_CLEANUP, {}, blobsContentCleanup);
  agenda.define(JOB_BLOBS_MISSING_RECORDS, {}, blobsMissingRecordsCleanup);
  agenda.define(JOB_PRUNE_TASKS, {}, pruneTasksJob);
  agenda.define(JOB_TASKS_HEALTH, {}, tasksHealth);
  agenda.define(JOB_BLOBS_TRANSFORMATION_QUEUE_CLEANUP, {}, blobsTransformationQueueCleanup);
  agenda.define(JOB_BLOBS_TRANSFORMATION_FAILED_CLEANUP, {}, blobsTransformationFailedQueueCleanup);
  agenda.define(JOB_BLOBS_PROCESSING_QUEUE_CLEANUP, {}, blobsProcessingQueueCleanup);

  function blobsMissingRecordsCleanup(_, done) {
    return blobsMissingRecords({
      doneCallback: done,
      state: [BLOB_STATE.TRANSFORMED]
    });
  }

  function blobsMetadataCleanup(_, done) {
    return blobsCleanup({
      method: 'deleteBlob',
      ttl: humanInterval(BLOBS_METADATA_TTL),
      doneCallback: done,
      messageCallback: count => `${count} blobs are waiting for blob removal. Estimated time of removal is modification time + ${BLOBS_METADATA_TTL}`,
      state: [BLOB_STATE.PROCESSED, BLOB_STATE.ABORTED]
    });
  }

  function blobsContentCleanup(_, done) {
    return blobsCleanup({
      method: 'deleteBlobContent',
      ttl: humanInterval(BLOBS_CONTENT_TTL),
      doneCallback: done,
      messageCallback: count => `${count} blobs are waiting for content cleanup. Estimated time of cleanning is modification time + ${BLOBS_CONTENT_TTL}`,
      state: [BLOB_STATE.PROCESSED, BLOB_STATE.ABORTED]
    });
  }

  function blobsTransformationQueueCleanup(_, done) {
    return blobsCleanup({
      method: 'requeueTransformationBlob',
      ttl: humanInterval(STALE_TRANSFORMATION_PROGRESS_TTL),
      doneCallback: done,
      messageCallback: count => `${count} blobs need to be removed from the transformation queue, due stale progress`,
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
      method: 'requeueImportBlob',
      ttl: humanInterval(STALE_PROCESSING_PROGRESS_TTL),
      doneCallback: done,
      messageCallback: count => `${count} blobs have importing error, restart importing`,
      state: [BLOB_STATE.PROCESSING]
    });
  }

  async function blobsMissingRecords({doneCallback, state}) {
    let connection; // eslint-disable-line functional/no-let
    let channel; // eslint-disable-line functional/no-let

    try {
      connection = await amqplib.connect(AMQP_URL);
      channel = await connection.createChannel();

      await processBlobs({
        client, processCallback,
        query: {state}
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

      doneCallback();
    }

    async function processCallback(blobs) {
      const [blob, ...rest] = blobs;
      if (blob === undefined) {
        return;
      }

      const {id, processedRecords, failedRecords, numberOfRecords, queuedRecords} = blob;
      const processedCount = processedRecords + failedRecords;
      const {messageCount} = await channel.assertQueue(id);

      if (messageCount === 0 && processedCount === 0 && queuedRecords === 0) {
        logger.warn(`Blob ${id} has lost the queue, setting state to PENDING_TRANSFORMATION (processedRecords: ${processedRecords}, messageCount: ${messageCount})`);
        await client.updateState({id, state: BLOB_STATE.PENDING_TRANSFORMATION});
        return processCallback(rest);
      }

      if (messageCount === 0 && processedCount > 0 && (processedCount + queuedRecords) < numberOfRecords) {
        logger.warn(`Blob ${id} has lost the queue, setting state to ABORTED (processedCount: ${processedCount}, messageCount: ${messageCount})`);
        await client.setAborted({id});
        return processCallback(rest);
      }

      if ((messageCount + processedCount + queuedRecords) === numberOfRecords) {
        return processCallback(rest);
      }

      logger.warn(`Blob ${id} is missing records from the queue (processedCount: ${processedCount}, numberOfRecords: ${numberOfRecords}, messageCount: ${messageCount}, queuedRecords: ${queuedRecords})`);
      return processCallback(rest);
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
          if (method === 'requeueTransformationBlob') {
            return moment().isAfter(modificationTime.add(ttl));
          }

          return modificationTime.add(ttl).isBefore(moment());
        }
      });
    } catch (error) {
      logError(error);
    } finally {
      if (channel) { // eslint-disable-line functional/no-conditional-statement
        await channel.close();
      }

      if (connection) { // eslint-disable-line functional/no-conditional-statement
        await connection.close();
      }

      doneCallback();
    }

    async function processCallback(blobs) {
      const [blob, ...rest] = blobs;
      if (blob === undefined) {
        return;
      }

      const {id} = blob;
      logger.silly(`Executing cleanup method ${method ? method : 'undefined'} for blob ${id}`);

      try {
        if (method === 'deleteBlob') {
          await terminateTasks({blob: id});
          await channel.deleteQueue(id);
          await client.deleteBlob({id});
          return processCallback(rest);
        }

        if (method === 'deleteBlobContent') {
          await client.deleteBlobContent({id});
          return processCallback(rest);
        }

        if (method === 'abortBlob') {
          await terminateTasks({blob: id});
          await client.setAborted({id});
          return processCallback(rest);
        }

        if (method === 'requeueImportBlob') {
          const tasks = await listTasks({blob: id, type: 'import'});
          if (tasks.length > 0) {
            await terminateTasks({blob: id});
            await client.updateState({id, state: BLOB_STATE.TRANSFORMED});
            return processCallback(rest);
          }

          await client.updateState({id, state: BLOB_STATE.TRANSFORMED});
          return processCallback(rest);
        }

        if (method === 'requeueTransformationBlob') {
          const tasks = await listTasks({blob: id, type: 'transform'});

          if (tasks.length === 0) {
            await channel.deleteQueue(id);
            logger.warn(`Blob ${id} has no transformer alive. Setting state to PENDING_TRANSFORMATION`);
            await client.updateState({id, state: BLOB_STATE.PENDING_TRANSFORMATION});
            return processCallback(rest);
          }

          return processCallback(rest);
        }

        return processCallback(rest);
      } catch (err) {
        if (err instanceof ApiError && err.status === HttpStatus.BAD_REQUEST && method === 'deleteBlob') {
          logger.warn(`Couldn't delete blob ${id} because content hasn't yet been deleted`);
          await client.deleteBlobContent({id});
          return processCallback(rest);
        }

        if (err instanceof ApiError && err.status === HttpStatus.NOT_FOUND) {
          if (method === 'deleteBlob' || method === 'deleteBlobContent') { // eslint-disable-line functional/no-conditional-statement
            logger.silly(`Blob ${id} or content already removed`);
          }

          return processCallback(rest);
        }

        logError(err);
        return processCallback(rest);
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
