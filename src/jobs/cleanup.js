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

import Docker from 'dockerode';
import moment from 'moment';
import amqplib from 'amqplib';
import HttpStatus from 'http-status';
import humanInterval from 'human-interval';
import {Utils} from '@natlibfi/melinda-commons';
import {BLOB_STATE, createApiClient, ApiError} from '@natlibfi/melinda-record-import-commons';
import {logError, stopContainers} from './utils';
import {
	API_URL, API_USERNAME, API_PASSWORD, API_CLIENT_USER_AGENT, AMQP_URL,
	JOB_BLOBS_METADATA_CLEANUP, JOB_BLOBS_CONTENT_CLEANUP,
	JOB_BLOBS_MISSING_RECORDS,
	JOB_PRUNE_CONTAINERS, JOB_CONTAINERS_HEALTH,
	BLOBS_METADATA_TTL, BLOBS_CONTENT_TTL
} from '../config';

const {createLogger} = Utils;

export default function (agenda) {
	const logger = createLogger();
	const client = createApiClient({
		url: API_URL, username: API_USERNAME, password: API_PASSWORD,
		userAgent: API_CLIENT_USER_AGENT
	});

	agenda.define(JOB_BLOBS_METADATA_CLEANUP, {concurrency: 1}, blobsMetadataCleanup);
	agenda.define(JOB_BLOBS_CONTENT_CLEANUP, {conccurency: 1}, blobsContentCleanup);
	agenda.define(JOB_BLOBS_MISSING_RECORDS, {concurrency: 1}, blobsMissingRecords);
	agenda.define(JOB_PRUNE_CONTAINERS, {concurrency: 1}, pruneContainers);
	agenda.define(JOB_CONTAINERS_HEALTH, {concurrency: 1}, containersHealth);

	async function blobsMetadataCleanup(_, done) {
		return blobsCleanup({
			method: 'deleteBlob',
			ttl: humanInterval(BLOBS_METADATA_TTL),
			callback: done,
			message: count => `${count} blobs need to be deleted.`
		});
	}

	async function blobsContentCleanup(_, done) {
		return blobsCleanup({
			method: 'deleteBlobContent',
			ttl: humanInterval(BLOBS_CONTENT_TTL),
			callback: done,
			message: count => `${count} blobs need to have their content deleted.`
		});
	}

	async function blobsCleanup({method, message, ttl, callback}) {
		let connection;
		let channel;

		try {
			connection = await amqplib.connect(AMQP_URL); // eslint-disable-line require-atomic-updates
			channel = await connection.createChannel();

			const blobs = await getBlobs();

			if (blobs.length > 0) {
				logger.log('debug', message(blobs.length));
				await processBlobs(blobs);
			}
		} finally {
			if (channel) {
				await channel.close();
			}

			if (connection) {
				await connection.close();
			}

			callback();
		}

		async function getBlobs() {
			const states = [BLOB_STATE.PROCESSED, BLOB_STATE.ABORTED];
			return filter(await client.getBlobs({state: states}));

			async function filter(blobs, list = []) {
				const blob = blobs.shift();

				if (blob) {
					const modificationTime = moment(blob.modificationTime);

					if (modificationTime.add(ttl).isBefore(moment())) {
						return filter(blobs, list.concat(blob.id));
					}

					return filter(blobs, list);
				}

				return list;
			}
		}

		async function processBlobs(blobs) {
			return Promise.all(blobs.map(async blob => {
				try {
					if (method === 'deleteBlob') {
						await channel.deleteQueue(blob);
					}

					await client[method]({id: blob});
				} catch (err) {
					if (err instanceof ApiError && err.status === HttpStatus.NOT_FOUND) {
						if (method === 'deleteBlob') {
							logger.log('debug', `Blob ${blob} already removed`);
						}
					} else {
						logError(err);
					}
				} finally {
					await stopContainers({
						label: [
							'fi.nationallibrary.melinda.record-import.container-type',
							`blobId=${blob}`
						]
					});
				}
			}));
		}
	}

	async function blobsMissingRecords(_, done) {
		let connection;
		let channel;

		try {
			connection = await amqplib.connect(AMQP_URL); // eslint-disable-line require-atomic-updates
			channel = await connection.createChannel(); // eslint-disable-line require-atomic-updates

			const blobs = await client.getBlobs({state: BLOB_STATE.TRANSFORMED});
			await processBlobs(blobs);
		} catch (err) {
			logError(err);
		} finally {
			if (channel) {
				await channel.close();
			}

			if (connection) {
				await connection.close();
			}

			done();
		}

		async function processBlobs(blobs) {
			const blob = blobs.shift();

			if (blob) {
				const {id, processedRecords, failedRecords, numberOfRecords} = blob;
				const processedCount = processedRecords + failedRecords;
				const {messageCount} = await channel.assertQueue(id);

				if (processedCount < numberOfRecords && messageCount === 0) {
					logger.log('warn', `Blob ${id} is missing records from the queue`);
				}

				return processBlobs(blobs);
			}
		}
	}

	async function pruneContainers(_, done) {
		const docker = new Docker();

		try {
			const result = await docker.pruneContainers({
				all: true,
				filters: {
					label: [
						'fi.nationallibrary.melinda.record-import.container-type'
					]
				}
			});

			if (Array.isArray(typeof result.ContainersDeleted)) {
				logger.log('debug', `Removed ${result.ContainersDeleted.length} inactive containers`);
			}
		} catch (pruneErr) {
			if (pruneErr.statusCode !== HttpStatus.CONFLICT) {
				throw pruneErr;
			}
		} finally {
			done();
		}
	}

	async function containersHealth(_, done) {
		try {
			await stopContainers({
				health: ['unhealthy'],
				label: ['fi.nationallibrary.melinda.record-import.container-type']
			});
		} finally {
			done();
		}
	}
}
