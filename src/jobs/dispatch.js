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
import Docker from 'dockerode';
import {Utils} from '@natlibfi/melinda-commons';
import {BLOB_STATE, createApiClient} from '@natlibfi/melinda-record-import-commons';
import {logError, stopContainers} from './utils';
import {
	API_URL, API_USERNAME, API_PASSWORD,
	CONTAINER_TEMPLATE_TRANSFORMER, CONTAINER_TEMPLATE_IMPORTER,
	JOB_BLOBS_PENDING, JOB_BLOBS_TRANSFORMED, JOB_BLOBS_ABORTED,
	CONTAINER_CONCURRENCY, IMPORTER_CONCURRENCY, API_CLIENT_USER_AGENT,
	CONTAINER_NETWORKS, IMPORT_OFFLINE_PERIOD
} from '../config';

const {createLogger} = Utils;

export default function (agenda) {
	const logger = createLogger();
	const docker = new Docker();
	const ApiClient = createApiClient({
		url: API_URL, username: API_USERNAME, password: API_PASSWORD,
		userAgent: API_CLIENT_USER_AGENT
	});

	agenda.define(JOB_BLOBS_PENDING, {concurrency: 1}, blobsPending);
	agenda.define(JOB_BLOBS_TRANSFORMED, {concurrency: 1}, blobsTransformed);
	agenda.define(JOB_BLOBS_ABORTED, {concurrency: 1}, blobsAborted);

	async function blobsPending(_, done) {
		try {
			const blobs = await ApiClient.getBlobs({state: BLOB_STATE.PENDING_TRANSFORMATION});			
			blobs.sort(blobsPrioritySort);

			if (blobs.length > 0) {
				logger.log('debug', `${blobs.length} blobs are pending transformation.`);
				await processBlobs(blobs);
			}
		} finally {
			done();
		}

		async function processBlobs(blobs) {
			const profileCache = {};

			return Promise.all(blobs.map(async blob => {
				try {
					const profile = await getProfile(blob.profile, profileCache);
					logger.log('debug', 'Starting TRANSFORMATION container');

					if (await canDispatch()) {
						await dispatchContainer({
							type: 'transformation',
							blob: blob.id,
							profile: profile.id,
							options: profile.transformation,
							template: CONTAINER_TEMPLATE_TRANSFORMER
						});

						await ApiClient.setTransformationStarted({id: blob.id});
						logger.log('info', `Transformation started for ${blob.id} `);
					} else {
						logger.log('warn', `Could not dispatch transformer for blob ${blob.id} because total number of containers is exhausted`);
					}
				} catch (err) {
					logError(err);
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
		const profileCache = {};

		try {
			const blobs = await ApiClient.getBlobs({state: BLOB_STATE.TRANSFORMED});			
			blobs.sort(blobsPrioritySort);

			if (blobs.length > 0) {
				logger.log('debug', `${blobs.length} blobs have records waiting to be imported.`);
				await processBlobs(blobs);
			}
		} finally {
			done();
		}

		async function processBlobs(blobs) {
			const blob = blobs.shift();

			if (blob) {
				const profile = await getProfile(blob.profile, profileCache);
				const dispatchCount = await getDispatchCount(profile);

				if (dispatchCount > 0) {
					if (isOfflinePeriod()) {
						logger.log('debug', 'Not dispatching importers during offline period');
					} else {
						logger.log('debug', `Dispatching ${dispatchCount} import containers for blob ${blob.id}`);
						await dispatchImporters(dispatchCount, profile);
					}
				} else {
					logger.log('debug', `Cannot dispatch importer containers for blob ${blob.id}. Maximum number of containers exhausted.`);
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
				const importerConcurrency = typeof profile.import.concurrency === 'number' ? profile.import.concurrency : IMPORTER_CONCURRENCY;
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

				logger.log('debug', `Running import containers for profile ${profile.id}: ${importers}/${importerConcurrency}. Running containers total: ${total}/${CONTAINER_CONCURRENCY}`);

				const availImporters = importerConcurrency - importers;
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
							type: 'import',
							blob: blob.id,
							profile: profile.id,
							options: profile.import,
							template: CONTAINER_TEMPLATE_IMPORTER
						});
					} catch (err) {
						logError(err);
					}
				}));

				function map(cb) {
					return new Array(count).fill(0).map(cb);
				}
			}
		}
	}

	async function blobsAborted(_, done) {
		try {
			const blobs = await ApiClient.getBlobs({state: BLOB_STATE.ABORTED});

			if (blobs.length > 0) {
				await processBlobs(blobs);
			}
		} finally {
			done();
		}

		async function processBlobs(blobs) {
			return Promise.all(blobs.map(async blob => {
				try {
					await stopContainers({
						label: [
							'fi.nationallibrary.melinda.record-import.container-type',
							`blobId=${blob.id}`
						]
					});
				} catch (err) {
					logError(err);
				}
			}));
		}
	}

	async function dispatchContainer({type, blob, profile, options, template}) {
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

		logger.log('debug', `ID of started ${type} container: ${info.id}`);

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

	async function getProfile(id, cache) {
		if (id in cache) {
			return cache[id];
		}

		cache[id] = await ApiClient.getProfile({id});
		return cache[id];
	}

	function blobsPrioritySort(a, b) {		
		const aCreationTime = moment(a.creationTime);
		const bCreationTime = moment(b.creationTime);

		if (aCreationTime.isBefore(bCreationTime)) {
			return -1;
		}

		if (bCreationTime.isBefore(aCreationTime)) {
			return 1;
		}

		return 0;
	}
}
