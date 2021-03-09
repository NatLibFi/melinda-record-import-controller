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
import {createLogger} from '@natlibfi/melinda-backend-commons';
import {BLOB_STATE, createApiClient, ApiError} from '@natlibfi/melinda-record-import-commons';
import {logError, stopContainers, processBlobs} from './utils';
import {
	API_URL, API_USERNAME, API_PASSWORD, API_CLIENT_USER_AGENT, AMQP_URL,
	JOB_BLOBS_METADATA_CLEANUP, JOB_BLOBS_CONTENT_CLEANUP,
	JOB_BLOBS_MISSING_RECORDS, JOB_BLOBS_TRANSFORMATION_QUEUE_CLEANUP,
	JOB_BLOBS_PROCESSING_QUEUE_CLEANUP, JOB_PRUNE_CONTAINERS, JOB_CONTAINERS_HEALTH,
	BLOBS_METADATA_TTL, BLOBS_CONTENT_TTL, STALE_TRANSFORMATION_PROGRESS_TTL,
	STALE_PROCESSING_PROGRESS_TTL
} from '../config';

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
	agenda.define(JOB_BLOBS_TRANSFORMATION_QUEUE_CLEANUP, {concurrency: 1}, blobsTransformationQueueCleanup);
	agenda.define(JOB_BLOBS_PROCESSING_QUEUE_CLEANUP, {concurrency: 1}, blobsProcessingQueueCleanup);

	async function blobsMetadataCleanup(_, done) {
		return blobsCleanup({
			method: 'deleteBlob',
			ttl: humanInterval(BLOBS_METADATA_TTL),
			doneCallback: done,
			messageCallback: count => `${count} blobs need to be deleted.`,
			state: [BLOB_STATE.PROCESSED, BLOB_STATE.ABORTED]
		});
	}

	async function blobsContentCleanup(_, done) {
		return blobsCleanup({
			method: 'deleteBlobContent',
			ttl: humanInterval(BLOBS_CONTENT_TTL),
			doneCallback: done,
			messageCallback: count => `${count} blobs need to have their content deleted.`,
			state: [BLOB_STATE.PROCESSED, BLOB_STATE.ABORTED]
		});
	}

	async function blobsTransformationQueueCleanup(_, done) {
		return blobsCleanup({
			method: 'reQueueBlob',
			ttl: humanInterval(STALE_TRANSFORMATION_PROGRESS_TTL),
			doneCallback: done,
			messageCallback: count => `${count} blobs need to have removed from transformation queue`,
			state: [BLOB_STATE.TRANSFORMATION_IN_PROGRESS]
		});
	}

	async function blobsProcessingQueueCleanup(_, done) {
		return blobsCleanup({
			method: 'abortBlob',
			ttl: humanInterval(STALE_PROCESSING_PROGRESS_TTL),
			doneCallback: done,
			messageCallback: count => `${count} blobs need to abort for restart`,
			state: [BLOB_STATE.PROCESSING]
		});
	}

	async function blobsMissingRecords(_, done) {
		let connection;
		let channel;

		try {
			connection = await amqplib.connect(AMQP_URL);
			channel = await connection.createChannel();

			await processBlobs({
				client, processCallback,
				query: {state: BLOB_STATE.PROCESSING}
			});
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

		async function processCallback(blobs) {
			const blob = blobs.shift();

			if (blob) {
				const {id, processedRecords, failedRecords, numberOfRecords} = blob;
				const processedCount = processedRecords + failedRecords;
				const {messageCount} = await channel.assertQueue(id);

				if (processedCount < numberOfRecords && messageCount === 0) {
					logger.log('warn', `Blob ${id} is missing records from the queue`);
				}

				return processCallback(blobs);
			}
		}
	}

	async function blobsCleanup({method, ttl, doneCallback, messageCallback, state}) {
		let connection;
		let channel;

		try {
			connection = await amqplib.connect(AMQP_URL);
			channel = await connection.createChannel();

			await processBlobs({
				client, processCallback, messageCallback,
				query: {state},
				filter: blob => {
					const modificationTime = moment(blob.modificationTime);
					if (method === 'reQueueBlob') {
						return moment().isAfter(modificationTime.add(ttl));
					}

					return modificationTime.add(ttl).isBefore(moment());
				}
			});
		} finally {
			if (channel) {
				await channel.close();
			}

			if (connection) {
				await connection.close();
			}

			doneCallback();
		}

		async function processCallback(blobs) {
			return Promise.all(blobs.map(async ({id}) => {
				try {
					if (method === 'deleteBlob' || method === 'reQueueBlob' || method === 'abortBlob') {
						await channel.deleteQueue(id);
					}

					if (method === 'abortBlob') {
						const docker = new Docker();
						const containers = await docker.listContainers({
							filters: {
								label: [
									'fi.nationallibrary.melinda.record-import.container-type=import-task',
									`blobId=${id}`
								]
							}
						});

						if (containers.length === 0) {
							logger.log('warn', `Blob ${id} has no importer alive. Setting state to ABORTED`);
							await client.setAborted({id});
							// await client.deleteBlobContent({id});
						}

						return true;
					}

					if (method === 'reQueueBlob') {
						const docker = new Docker();
						const containers = await docker.listContainers({
							filters: {
								label: [
									'fi.nationallibrary.melinda.record-import.container-type=transform-task',
									`blobId=${id}`
								]
							}
						});
						if (containers.length === 0) {
							logger.log('warn', `Blob ${id} has no transformer alive. Setting state to PENDING_TRANSFORMATION`);
							await client.updateState({id, state: BLOB_STATE.PENDING_TRANSFORMATION});
						}

						return true;
					}

					await client[method]({id});
				} catch (err) {
					if (err instanceof ApiError && err.status === HttpStatus.NOT_FOUND) {
						if (method === 'deleteBlob') {
							logger.log('debug', `Blob ${id} already removed`);
						}
					} else {
						logError(err);
					}
				} finally {
					if (method !== 'reQueueBlob') {
						await stopContainers({
							label: [
								'fi.nationallibrary.melinda.record-import.container-type',
								`blobId=${id}`
							]
						});
					}
				}
			}));
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
