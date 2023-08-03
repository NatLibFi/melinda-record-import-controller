/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* API microservice of Melinda record batch import system
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

import {createLogger, handleInterrupt} from '@natlibfi/melinda-backend-commons';
import {MongoClient, MongoError} from 'mongodb';

import Agenda from 'agenda';
import createJobs from './jobs';
import * as config from './config';

run();

async function run() {
  const {
    MONGO_URI, TZ,
    JOB_BLOBS_PENDING, JOB_BLOBS_ABORTED, JOB_BLOBS_PROCESSING,
    JOB_BLOBS_METADATA_CLEANUP, JOB_BLOBS_CONTENT_CLEANUP, JOB_BLOBS_MISSING_RECORDS,
    JOB_PRUNE_TASKS, JOB_FREQ_BLOBS_PENDING, JOB_FREQ_BLOBS_ABORTED, JOB_FREQ_BLOBS_PROCESSING,
    JOB_FREQ_PRUNE_TASKS, JOB_FREQ_BLOBS_METADATA_CLEANUP, JOB_FREQ_BLOBS_CONTENT_CLEANUP,
    JOB_FREQ_BLOBS_MISSING_RECORDS, JOB_BLOBS_TRANSFORMATION_QUEUE_CLEANUP,
    JOB_FREQ_BLOBS_TRANSFORMATION_QUEUE_CLEANUP, JOB_FREQ_BLOBS_PROCESSING_QUEUE_CLEANUP,
    JOB_FREQ_BLOBS_TRANSFORMATION_FAILED_CLEANUP, JOB_BLOBS_PROCESSING_QUEUE_CLEANUP,
    JOB_BLOBS_TRANSFORMATION_FAILED_CLEANUP, JOB_BLOBS_TRANSFORMATION_FAILED_CONTENT_CLEANUP,
    JOB_FREQ_BLOBS_TRANSFORMATION_FAILED_CONTENT_CLEANUP
  } = config;

  const logger = createLogger();
  const Mongo = await MongoClient.connect(MONGO_URI, {useNewUrlParser: true});

  Mongo.on('error', err => {
    logger.error('Error stack' in err ? err.stack : err);
    process.exit(1); // eslint-disable-line no-process-exit
  });

  process
    .on('SIGINT', handleExit)
    .on('unhandledRejection', handleExit)
    .on('uncaughtException', handleExit);

  await initDb();
  const agenda = new Agenda({
    mongo: Mongo.db(),
    maxConcurrency: 1,
    defaultConcurrency: 1
  });

  // Agenda.sort({nextRunAt: 1});

  agenda.on('error', handleExit);
  agenda.on('ready', () => {
    const opts = TZ ? {timezone: TZ} : {};

    createJobs(agenda, config);

    agenda.every(JOB_FREQ_BLOBS_PENDING, JOB_BLOBS_PENDING, undefined, opts);
    agenda.every(JOB_FREQ_BLOBS_PROCESSING, JOB_BLOBS_PROCESSING, {}, opts);
    agenda.every(JOB_FREQ_BLOBS_ABORTED, JOB_BLOBS_ABORTED, undefined, opts);
    agenda.every(JOB_FREQ_BLOBS_TRANSFORMATION_QUEUE_CLEANUP, JOB_BLOBS_TRANSFORMATION_QUEUE_CLEANUP, undefined, opts);
    agenda.every(JOB_FREQ_BLOBS_PROCESSING_QUEUE_CLEANUP, JOB_BLOBS_PROCESSING_QUEUE_CLEANUP, undefined, opts);
    agenda.every(JOB_FREQ_BLOBS_TRANSFORMATION_FAILED_CLEANUP, JOB_BLOBS_TRANSFORMATION_FAILED_CLEANUP, undefined, opts);
    agenda.every(JOB_FREQ_BLOBS_TRANSFORMATION_FAILED_CONTENT_CLEANUP, JOB_BLOBS_TRANSFORMATION_FAILED_CONTENT_CLEANUP, undefined, opts);

    if (JOB_FREQ_PRUNE_TASKS === 'never') { // eslint-disable-line functional/no-conditional-statements
      logger.info(`Job ${JOB_PRUNE_TASKS} is disabled`);
    } else { // eslint-disable-line functional/no-conditional-statements
      agenda.every(JOB_FREQ_PRUNE_TASKS, JOB_PRUNE_TASKS);
    }

    if (JOB_FREQ_BLOBS_METADATA_CLEANUP === 'never') { // eslint-disable-line functional/no-conditional-statements
      logger.info(`Job ${JOB_BLOBS_METADATA_CLEANUP} is disabled`);
    } else { // eslint-disable-line functional/no-conditional-statements
      agenda.every(JOB_FREQ_BLOBS_METADATA_CLEANUP, JOB_BLOBS_METADATA_CLEANUP);
    }

    if (JOB_FREQ_BLOBS_CONTENT_CLEANUP === 'never') { // eslint-disable-line functional/no-conditional-statements
      logger.info(`Job ${JOB_BLOBS_CONTENT_CLEANUP} is disabled`);
    } else { // eslint-disable-line functional/no-conditional-statements
      agenda.every(JOB_FREQ_BLOBS_CONTENT_CLEANUP, JOB_BLOBS_CONTENT_CLEANUP);
    }

    if (JOB_FREQ_BLOBS_MISSING_RECORDS === 'never') { // eslint-disable-line functional/no-conditional-statements
      logger.info(`Job ${JOB_BLOBS_MISSING_RECORDS} is disabled`);
    } else { // eslint-disable-line functional/no-conditional-statements
      agenda.every(JOB_FREQ_BLOBS_MISSING_RECORDS, JOB_BLOBS_MISSING_RECORDS);
    }

    agenda.start();
    logger.info('Started melinda-record-import-controller');
  });

  async function initDb() {
    const db = Mongo.db();
    try {
      // Remove collection because it causes problems after restart
      await db.dropCollection('agendaJobs');
      await db.createCollection('agendaJobs');
    } catch (err) {
      // NamespaceNotFound === Collection doesn't exist
      if (err instanceof MongoError && err.code === 26) {
        return;
      }

      throw err;
    }
  }

  async function handleExit(arg) {
    await Mongo.close();
    handleInterrupt(arg);
  }
}
