/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* API microservice of Melinda record batch import system
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

import {Utils} from '@natlibfi/melinda-commons';
import {MongoClient, MongoError} from 'mongodb';

import Agenda from 'agenda';
import createJobs from './jobs';
import createTaskInterface from './task-interface';
import * as config from './config';

run();

async function run() {
	const {createLogger, handleInterrupt} = Utils;

	const {
		MONGO_URI, TZ,
		JOB_BLOBS_PENDING, JOB_BLOBS_TRANSFORMED, JOB_BLOBS_ABORTED,
		JOB_BLOBS_METADATA_CLEANUP, JOB_BLOBS_CONTENT_CLEANUP, JOB_BLOBS_MISSING_RECORDS,
		JOB_TASKS_HEALTH, JOB_PRUNE_TASKS, JOB_UPDATE_IMAGES,
		JOB_FREQ_BLOBS_PENDING, JOB_FREQ_BLOBS_TRANSFORMED,	JOB_FREQ_BLOBS_ABORTED,
		JOB_FREQ_TASKS_HEALTH, JOB_FREQ_PRUNE_TASKS, JOB_FREQ_UPDATE_IMAGES,
		JOB_FREQ_BLOBS_METADATA_CLEANUP, JOB_FREQ_BLOBS_CONTENT_CLEANUP,
		JOB_FREQ_BLOBS_MISSING_RECORDS, JOB_BLOBS_TRANSFORMATION_QUEUE_CLEANUP,
		JOB_FREQ_BLOBS_TRANSFORMATION_QUEUE_CLEANUP
	} = config;

	const Logger = createLogger();
	const Mongo = await MongoClient.connect(MONGO_URI, {useNewUrlParser: true});
	const taskInterface = await createTaskInterface(config);

	Mongo.on('error', err => {
		Logger.log('error', 'Error stack' in err ? err.stack : err);
		process.exit(1);
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

		createJobs(agenda, {...taskInterface, ...config});

		agenda.every(JOB_FREQ_BLOBS_TRANSFORMED, JOB_BLOBS_TRANSFORMED, {}, opts);
		agenda.every(JOB_FREQ_BLOBS_PENDING, JOB_BLOBS_PENDING, undefined, opts);
		agenda.every(JOB_FREQ_BLOBS_ABORTED, JOB_BLOBS_ABORTED, undefined, opts);
		agenda.every(JOB_FREQ_TASKS_HEALTH, JOB_TASKS_HEALTH, undefined, opts);
		agenda.every(JOB_FREQ_UPDATE_IMAGES, JOB_UPDATE_IMAGES, undefined, opts);
		agenda.every(JOB_FREQ_BLOBS_TRANSFORMATION_QUEUE_CLEANUP, JOB_BLOBS_TRANSFORMATION_QUEUE_CLEANUP, undefined, opts);

		if (JOB_FREQ_PRUNE_TASKS === 'never') {
			Logger.log('info', `Job ${JOB_PRUNE_TASKS} is disabled`);
		} else {
			agenda.every(JOB_FREQ_PRUNE_TASKS, JOB_PRUNE_TASKS);
		}

		if (JOB_FREQ_BLOBS_METADATA_CLEANUP === 'never') {
			Logger.log('info', `Job ${JOB_BLOBS_METADATA_CLEANUP} is disabled`);
		} else {
			agenda.every(JOB_FREQ_BLOBS_METADATA_CLEANUP, JOB_BLOBS_METADATA_CLEANUP);
		}

		if (JOB_FREQ_BLOBS_CONTENT_CLEANUP === 'never') {
			Logger.log('info', `Job ${JOB_BLOBS_CONTENT_CLEANUP} is disabled`);
		} else {
			agenda.every(JOB_FREQ_BLOBS_CONTENT_CLEANUP, JOB_BLOBS_CONTENT_CLEANUP);
		}

		if (JOB_FREQ_BLOBS_MISSING_RECORDS === 'never') {
			Logger.log('info', `Job ${JOB_BLOBS_MISSING_RECORDS} is disabled`);
		} else {
			agenda.every(JOB_FREQ_BLOBS_MISSING_RECORDS, JOB_BLOBS_MISSING_RECORDS);
		}

		agenda.start();
		Logger.log('info', 'Started melinda-record-import-controller');
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
