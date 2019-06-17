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
	JOB_BLOBS_PENDING, JOB_BLOBS_TRANSFORMED, JOB_BLOBS_ABORTED, JOB_BLOBS_TRANSFORMATION_IN_PROGRESS,
	CONTAINER_CONCURRENCY, IMPORTER_CONCURRENCY, API_CLIENT_USER_AGENT,
	CONTAINER_NETWORKS, IMPORT_OFFLINE_PERIOD, PROCESS_START_TIME,
	STALE_TRANSFORMATION_PROGRESS_TTL, STALE_TRANSFORMED_TTL, MAX_BLOB_IMPORT_TRIES
} from '../config';

const {createLogger} = Utils;

export default function (agenda) {
	const logger = createLogger();
	const client = createApiClient({
		url: API_URL, username: API_USERNAME, password: API_PASSWORD,
		userAgent: API_CLIENT_USER_AGENT
	});

	agenda.define(JOB_BLOBS_PENDING, {concurrency: 1}, blobsPending);
	agenda.define(JOB_BLOBS_TRANSFORMED, {concurrency: 1}, blobsTransformed);
	agenda.define(JOB_BLOBS_ABORTED, {concurrency: 1}, blobsAborted);
	agenda.define(JOB_BLOBS_TRANSFORMATION_IN_PROGRESS, {concurrency: 1}, blobsTransformationInProgress);

	async function blobsPending(_, done) {
		const docker = new Docker();

		try {
			const blobs = await client.getBlobs({state: BLOB_STATE.PENDING_TRANSFORMATION});
			blobs.sort(blobsCreationTimeSort);

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

					if (await canDispatch()) {
						await dispatchContainer({
							docker,
							type: 'transformation',
							blob: blob.id,
							profile: profile.id,
							options: profile.transformation,
							template: CONTAINER_TEMPLATE_TRANSFORMER
						});

						await client.updateState({id: blob.id, state: BLOB_STATE.TRANSFORMATION_IN_PROGRESS});
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

	async function blobsTransformed({attrs: {data: blobsTryCount}}, done) {
		const profileCache = {};
		const docker = new Docker();

		try {
			const blobs = (await client.getBlobs({state: BLOB_STATE.TRANSFORMED}))
				.sort(blobsCreationTimeSort)
				.sort(blobsStalenessSort);

			if (blobs.length > 0) {
				cleanTryCount(blobs);
				logger.log('debug', `${blobs.length} blobs have records waiting to be imported.`);
				await processBlobs({blobs});
			}
		} catch (err) {
			logError(err);
		} finally {
			done();
		}

		function cleanTryCount(blobs) {
			Object.keys(blobsTryCount).forEach(id => {
				if (blobs.some(blob => blob.id === id)) {
					return;
				}

				delete blobsTryCount[id];
			});
		}

		function blobsStalenessSort(a, b) {
			const aIsStale = isStale(a);
			const bIsStale = isStale(b);

			if (aIsStale && bIsStale) {
				return 0;
			}

			if (aIsStale) {
				return 1;
			}

			if (bIsStale) {
				return -1;
			}

			function isStale({id, modificationTime}) {
				const tryCount = id in blobsTryCount ? blobsTryCount[id] : 0;
				return tryCount > MAX_BLOB_IMPORT_TRIES && isTooOld();

				function isTooOld() {
					return PROCESS_START_TIME.diff(moment(modificationTime)) > STALE_TRANSFORMED_TTL;
				}
			}
		}

		async function processBlobs({blobs, profilesExhausted = []}) {
			const blob = blobs.shift();

			if (blob) {
				if (await allRecordsProcessed()) {
					logger.log('debug', `All records of blob ${blob.id} have been processed. Setting state to PROCESSED`);
					await client.updateState({id: blob.id, state: BLOB_STATE.PROCESSED});
					return processBlobs({blobs, profilesExhausted});
				}

				if (profilesExhausted.includes(blob.profile)) {
					return processBlobs({blobs, profilesExhausted});
				}

				const profile = await getProfile(blob.profile, profileCache);
				const {dispatchCount, totalLimitAfterDispatch} = await getDispatchCount(profile);

				if (dispatchCount > 0) {
					if (isOfflinePeriod()) {
						logger.log('debug', 'Not dispatching importers during offline period');
					} else {
						logger.log('debug', `Dispatching ${dispatchCount} import containers for blob ${blob.id}`);
						await dispatchImporters({docker, dispatchCount, profile});

						blobsTryCount[blob.id] = blobsTryCount[blob.id] ? blobsTryCount[blob.id] + 1 : 1;

						if (totalLimitAfterDispatch <= 0) {
							logger.log('debug', 'Not processing further blobs because total container limit is exhausted');
							return;
						}
					}
				} else {
					logger.log('debug', `Cannot dispatch importer containers for blob ${blob.id}. Maximum number of containers exhausted.`);
					profilesExhausted.push(blob.profile);
				}

				return processBlobs({blobs, profilesExhausted});
			}

			logger.log('debug', 'All blobs checked');

			async function allRecordsProcessed() {
				const {processingInfo: {numberOfRecords, failedRecords, importResults}} = await client.getBlobMetadata({id: blob.id});
				return numberOfRecords === failedRecords.length + importResults.length;
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
						return {
							dispatchCount: availImporters,
							totalLimitAfterDispatch: availTotal - availImporters
						};
					}

					return {
						dispatchCount: availImporters - availTotal,
						totalLimitAfterDispatch: availTotal - availImporters
					};
				}

				return {dispatchCount: 0};
			}

			async function dispatchImporters({docker, dispatchCount, profile}) {
				return Promise.all(map(async () => {
					try {
						await dispatchContainer({
							docker,
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
					return new Array(dispatchCount).fill(0).map(cb);
				}
			}
		}
	}

	async function blobsAborted(_, done) {
		try {
			const blobs = await client.getBlobs({state: BLOB_STATE.ABORTED});

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

	async function blobsTransformationInProgress(_, done) {
		const docker = new Docker();

		try {
			const blobs = await client.getBlobs({state: BLOB_STATE.TRANSFORMATION_IN_PROGRESS});

			if (blobs.length > 0) {
				logger.log('debug', `${blobs.length} blobs have transformation in progress`);
				await processBlobs(blobs);
			}
		} finally {
			done();
		}

		async function processBlobs(blobs) {
			return Promise.all(blobs.map(async blob => {
				try {
					const {processingInfo: {numberOfRecords}, modificationTime} = await client.getBlobMetadata({id: blob.id});

					if (numberOfRecords > 0) {
						return client.updateState({id: blob.id, state: BLOB_STATE.TRANSFORMED});
					}

					const containers = await docker.listContainers({
						filters: {
							label: [
								'fi.nationallibrary.melinda.record-import.container-type=transform-task',
								`blobId=${blob.id}`
							]
						}
					});

					// Transformer was apparently terminated abruptly
					if (containers.length === 0 && isTooOld(modificationTime)) {
						logger.log('warn', `Blob ${blob.id} has no transformer alive. Setting state to PENDING_TRANSFORMATION`);
						return client.updateState({id: blob.id, state: BLOB_STATE.PENDING_TRANSFORMATION});
					}
				} catch (err) {
					logError(err);
				}

				function isTooOld(modificationTime) {
					const lastUpdated = moment(modificationTime);
					return moment().diff(lastUpdated) > STALE_TRANSFORMATION_PROGRESS_TTL;
				}
			}));
		}
	}

	async function dispatchContainer({docker, type, blob, profile, options, template}) {
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

	function blobsCreationTimeSort(a, b) {
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

	async function getProfile(id, cache) {
		if (id in cache) {
			return cache[id];
		}

		cache[id] = await client.getProfile({id});
		return cache[id];
	}
}
