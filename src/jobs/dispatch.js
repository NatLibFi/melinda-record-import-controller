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
import HttpStatus from 'http-status';
import Docker from 'dockerode';
import amqplib from 'amqplib';
import {promisify} from 'util';
import {Utils} from '@natlibfi/melinda-commons';
import {BLOB_STATE, createApiClient, ApiError} from '@natlibfi/melinda-record-import-commons';
import {
	API_URL, API_USERNAME, API_PASSWORD,
	AMQP_URL, QUEUE_MAX_MESSAGE_TRIES, QUEUE_MESSAGE_WAIT_TIME,
	CONTAINER_TEMPLATE_TRANSFORMER, CONTAINER_TEMPLATE_IMPORTER,
	JOB_BLOBS_PENDING, JOB_BLOBS_TRANSFORMED, JOB_BLOBS_ABORTED, JOB_CONTAINERS_HEALTH,
	CONTAINER_CONCURRENCY, IMPORTER_CONCURRENCY, API_CLIENT_USER_AGENT,
	CONTAINER_NETWORKS, IMPORT_OFFLINE_PERIOD
} from '../config';

const {createLogger} = Utils;

export default function (agenda) {
	const Logger = createLogger();
	const setTimeoutPromise = promisify(setTimeout);
	const docker = new Docker();
	const ApiClient = createApiClient({
		url: API_URL, username: API_USERNAME, password: API_PASSWORD,
		userAgent: API_CLIENT_USER_AGENT
	});

	agenda.define(JOB_BLOBS_PENDING, blobsPending);
	agenda.define(JOB_BLOBS_TRANSFORMED, blobsTransformed);
	agenda.define(JOB_BLOBS_ABORTED, blobsAborted);
	agenda.define(JOB_CONTAINERS_HEALTH, containersHealth);

	async function blobsPending(_, done) {
		const blobs = await ApiClient.getBlobs({state: BLOB_STATE.PENDING_TRANSFORMATION});

		if (blobs.length > 0) {
			Logger.log('debug', `${blobs.length} blobs are pending transformation.`);
			await processBlobs();
		}

		done();

		async function processBlobs() {
			return Promise.all(blobs.map(async blob => {
				try {
					const profile = await getBlobProfile(blob.id);
					Logger.log('debug', 'Starting TRANSFORMATION container');

					if (await canDispatch()) {
						await dispatchContainer({
							blob: blob.id,
							profile: profile.id,
							options: profile.transformation,
							template: CONTAINER_TEMPLATE_TRANSFORMER
						});

						await ApiClient.setTransformationStarted({id: blob.id});
						Logger.log('info', `Transformation started for ${blob.id} `);
					} else {
						Logger.log('warn', `Could not dispatch transformer for blob ${blob.id} because total number of containers is exhausted`);
					}
				} catch (err) {
					Logger.log('error', err.stack);
				}

				async function canDispatch() {
					const runningContainers = await docker.listContainers({
						filters: {
							label: ['fi.nationallibrary.melinda.record-import.container-type']
						}
					});

					return runningContainers.length < CONTAINER_CONCURRENCY;
				}
			}));
		}
	}

	async function blobsTransformed(_, done) {
		try {
			const blobs = await ApiClient.getBlobs({state: BLOB_STATE.TRANSFORMED});

			if (blobs.length > 0) {
				Logger.log('debug', `${blobs.length} blobs have records waiting to be imported.`);
				await processBlobs(blobs);
			}
		} finally {
			done();
		}

		done();

		async function processBlobs(blobs) {
			const blob = blobs.shift();

			if (blob) {
				const profile = await getBlobProfile(blob.id);
				const dispatchCount = await getDispatchCount(profile);

				if (dispatchCount > 0) {
					if (isOfflinePeriod()) {
						Logger.log('debug', 'Not dispatching importers during offline period');
					} else {
						Logger.log('debug', `Dispatching ${dispatchCount} import containers for blob ${blob.id}`);
						await dispatchImporters(dispatchCount, profile);
					}
				} else {
					Logger.log('warn', `Cannot dispatch importer containers for blob ${blob.id}. Maximum number of containers exhausted.`);
				}

				return processBlobs(blobs);
			}

			function isOfflinePeriod() {
				const {startHour, lengthHours} = IMPORT_OFFLINE_PERIOD;
				const now = moment();

				if (startHour !== undefined && lengthHours !== undefined) {
					if (now.hour() < startHour) {
						const start = moment(now).hour(startHour).subtract(1, 'days');
						return check(start);
					}

					const start = moment(now).hour(startHour);
					return check(start);
				}

				function check(startTime) {
					const endTime = moment(startTime).add(lengthHours, 'hours');
					return now >= startTime && now < endTime;
				}
			}

			async function getDispatchCount(profile) {
				const total = (await docker.listContainers({
					filters: {
						label: ['fi.nationallibrary.melinda.record-import.container-type']
					}
				})).length;

				const importers = (await docker.listContainers({
					filters: {
						label: [
							'fi.nationallibrary.melinda.record-import.container-type=import-task',
							`profile=${profile.id}`
						]
					}
				})).length;

				Logger.log('debug', `Running import containers for profile ${profile.id}: ${importers}/${IMPORTER_CONCURRENCY}. Running containers total: ${total}/${CONTAINER_CONCURRENCY}`);

				const availImporters = IMPORTER_CONCURRENCY - importers;
				const availTotal = CONTAINER_CONCURRENCY - total;

				if (availImporters > 0 && availTotal > 0) {
					if (availTotal >= availImporters) {
						return availImporters;
					}

					return availImporters - availTotal;
				}

				return 0;
			}

			async function dispatchImporters(count, profile) {
				return Promise.all(map(async () => {
					try {
						await dispatchContainer({
							blob: blob.id,
							profile: profile.id,
							options: profile.import,
							template: CONTAINER_TEMPLATE_IMPORTER
						});
					} catch (err) {
						Logger.log('error', err.stack);
					}
				}));

				function map(cb) {
					return new Array(count).fill(0).map(cb);
				}
			}
		}
	}

	async function blobsAborted(_, done) {
		const blobs = await ApiClient.getBlobs({state: BLOB_STATE.ABORTED});

		if (blobs.length > 0) {
			await processBlobs();
		}

		done();

		async function processBlobs() {
			return Promise.all(blobs.map(async blob => {
				try {
					const containers = await docker.listContainers({
						filters: {
							label: [
								'fi.nationallibrary.melinda.record-import.container-type',
								`blobId=${blob.id}`
							]
						}
					});

					if (containers.length > 0) {
						Logger.log('debug', `Stopping ${containers.length} containers because blob ${blob.id} state is set to ABORTED.`);
						await stopContainers(containers);
					}

					await cleanQueue(blob.id);
				} catch (err) {
					Logger.log('error', err.stack);
				}
			}));

			async function stopContainers(containers) {
				return Promise.all(containers.map(async container => {
					try {
						await docker.getContainer(container.id).stop();
					} catch (err) {
						Logger.log('error', err.stack);
					}
				}));
			}

			async function cleanQueue(blob) {
				const profile = (await ApiClient.getBlobMetadata({id: blob})).profile;
				const connection = await amqplib.connect(AMQP_URL);
				const channel = await connection.createChannel();

				if (await channel.checkQueue(profile)) {
					await consume();
				}

				await channel.close();
				await connection.close();

				async function consume(tries = 0) {
					const message = await channel.get(profile);

					if (message && message.fields.routingKey === blob) {
						await channel.nack(message, false, false);

						return consume();
					}

					if (tries < QUEUE_MAX_MESSAGE_TRIES) {
						await setTimeoutPromise(QUEUE_MESSAGE_WAIT_TIME);
						return consume(tries + 1);
					}

					Logger.log('debug', `Purged queue of records related to blob ${blob.id} from queue`);
				}
			}
		}
	}

	async function containersHealth(_, done) {
		const containersInfo = await docker.listContainers({
			all: true,
			filters: {
				health: ['unhealthy'],
				label: ['fi.nationallibrary.melinda.record-import.container-type']
			}
		});

		if (containersInfo.length > 0) {
			await Promise.all(containersInfo.map(async info => {
				try {
					const cont = await docker.getContainer(info.id);

					if (info.running) {
						Logger.log('debug', 'Stopping unhealthy container');
						await cont.stop();
					}

					try {
						const blobMetadata = await ApiClient.getBlobMetadata({id: info.Labels.blobId});

						if (blobMetadata.state === BLOB_STATE.TRANSFORMATION_IN_PROGRESS) {
							Logger.log('debug', `Setting state to TRANSFORMATION_FAILED for blob ${blobMetadata.id} because container was unhealthy.`);
							await ApiClient.setTransformationFailed({id: blobMetadata.id, error: `Unexpected error. Container id: ${info.Id}`});
						}
					} catch (err) {
						if (err instanceof ApiError && err.status === HttpStatus.NOT_FOUND) {
							Logger.log('debug', `Blob ${info.Labels.blobId} already removed. Removing all related containers`);

							await docker.pruneContainers({
								all: true,
								filters: {
									label: [
										'fi.nationallibrary.melinda.record-import.container-type',
										`blobId=${info.Labels.blobId}`
									]
								}
							});
						} else {
							throw err;
						}
					}
				} catch (err) {
					Logger.log('error', err.stack);
				}
			}));
		}

		done();
	}

	async function getBlobProfile(blob) {
		const metadata = await ApiClient.getBlobMetadata({id: blob});
		return ApiClient.getProfile({id: metadata.profile});
	}

	async function dispatchContainer({blob, profile, options, template}) {
		const manifest = {
			Image: options.image,
			...template
		};

		manifest.Labels.blobId = blob;
		manifest.Labels.profile = profile;
		manifest.Env.push(`PROFILE_ID=${profile}`);
		manifest.Env.push(`BLOB_ID=${blob}`);

		getEnv(options.env).forEach(v => manifest.Env.push(v));

		const cont = await docker.createContainer(manifest);

		await attachToNetworks();

		const info = await cont.start();

		Logger.log('info', `ID of started container: ${info.id}`);

		function getEnv(env = {}) {
			return Object.keys(env).map(k => `${k}=${env[k]}`);
		}

		async function attachToNetworks() {
			return Promise.all(CONTAINER_NETWORKS.map(async networkName => {
				const network = await docker.getNetwork(networkName);
				await network.connect({
					Container: cont.id
				});
			}));
		}
	}
}
