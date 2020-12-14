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
import {logError, stopContainers, processBlobs} from './utils';
import {
	API_URL, API_USERNAME, API_PASSWORD,
	CONTAINER_TEMPLATE_TRANSFORMER, CONTAINER_TEMPLATE_IMPORTER,
	JOB_BLOBS_PENDING, JOB_BLOBS_PROSESSING, JOB_BLOBS_TRANSFORMED, JOB_BLOBS_ABORTED,
	CONTAINER_CONCURRENCY, IMPORTER_CONCURRENCY, API_CLIENT_USER_AGENT,
	CONTAINER_NETWORKS, IMPORT_OFFLINE_PERIOD
} from '../config';

export default function (agenda) {
	const {createLogger, clone} = Utils;
	const logger = createLogger();
	const client = createApiClient({
		url: API_URL, username: API_USERNAME, password: API_PASSWORD,
		userAgent: API_CLIENT_USER_AGENT
	});

	agenda.define(JOB_BLOBS_PENDING, {concurrency: 1}, blobsPending);
	agenda.define(JOB_BLOBS_PROSESSING, {concurrency: 1}, blobsProcessing);
	agenda.define(JOB_BLOBS_TRANSFORMED, {concurrency: 1}, blobsTransformed);
	agenda.define(JOB_BLOBS_ABORTED, {concurrency: 1}, blobsAborted);

	async function blobsPending(_, done) {
		const docker = new Docker();

		try {
			await processBlobs({
				client, processCallback,
				query: {state: BLOB_STATE.PENDING_TRANSFORMATION},
				messageCallback: count => `${count} blobs are pending transformation`
			});
		} finally {
			done();
		}

		async function processCallback(blobs) {
			const profileCache = {};

			return dispatch(blobs);

			async function dispatch(blobs) {
				const blob = blobs[0];

				if (blob) {
					const {id, profile: profileId} = blob;

					try {
						const {transformation: transformationOptions} = await getProfile(profileId, profileCache);

						if (await canDispatch()) {
							await dispatchContainer({
								docker,
								type: 'transformation',
								blob: id,
								profile: profileId,
								options: transformationOptions,
								template: CONTAINER_TEMPLATE_TRANSFORMER
							});

							await client.updateState({id, state: BLOB_STATE.TRANSFORMATION_IN_PROGRESS});
							logger.log('info', `Transformation started for ${id} `);

							return dispatch(blobs.slice(1));
						}

						logger.log('warn', `Could not dispatch transformer for blob ${id} because total number of containers is exhausted`);
						return;
					} catch (err) {
						logError(err);
					}
				}

				async function canDispatch() {
					const runningContainers = await docker.listContainers({
						filters: {
							label: ['fi.nationallibrary.melinda.record-import.container-type']
						}
					});

					return runningContainers.length < CONTAINER_CONCURRENCY;
				}
			}
		}
	}

	async function blobsProcessing(_, done) {
		logger.log('debug', 'Checking blobs in processing');
		const profileCache = {};

		try {
			await processBlobs({
				client, processCallback,
				query: {state: BLOB_STATE.PROCESSING},
				messageCallback: count => `${count} blobs are in process to be imported`
			});
		} catch (err) {
			logError(err);
		} finally {
			done();
		}

		async function processCallback(blobs) {

			await doProcessing({blobs});

			async function doProcessing({blobs}) {
				const blob = blobs.shift();

				if (blob) {
					const {numberOfRecords, processedRecords, failedRecords, id} = blob;

					if (numberOfRecords === processedRecords + failedRecords) {
						logger.log('debug', `All records of blob ${id} have been processed. Setting state to PROCESSED`);
						await client.updateState({id, state: BLOB_STATE.PROCESSED});
						return doProcessing({blobs});
					}

					return doProcessing({blobs});
				}
			}
		}
	}


	async function blobsTransformed({attrs: {data: blobsTryCount}}, done) {
		logger.log('debug', 'Checking transformed blobs');
		const profileCache = {};
		const docker = new Docker();

		try {
			await processBlobs({
				client, processCallback,
				query: {state: BLOB_STATE.TRANSFORMED},
				messageCallback: count => `${count} blobs have records waiting to be imported`
			});
		} catch (err) {
			logError(err);
		} finally {
			done();
		}

		async function processCallback(blobs, justStateCheck) {
			Object.keys(blobsTryCount).forEach(({id}) => {
				if (blobs.some(({id: otherId}) => otherId === id)) {
					return;
				}

				delete blobsTryCount[id];
			});

			await doProcessing({blobs, justStateCheck});

			async function doProcessing({blobs, profilesExhausted = []}) {
				const blob = blobs.shift();

				if (blob) {
					const {id, profile: profileId} = blob;

					if (profilesExhausted.includes(profileId) || justStateCheck) {
						return doProcessing({blobs, profilesExhausted});
					}

					const profile = await getProfile(profileId, profileCache);
					const {dispatch, totalLimitAfterDispatch} = await getDispatchCount(profile);

					if (dispatch) {
						if (isOfflinePeriod()) {
							logger.log('debug', 'Not dispatching importers during offline period');
						} else {
							logger.log('debug', `Dispatching 1 import containers for blob ${id}`);
							await client.updateState({id, state: BLOB_STATE.PROCESSING});
							await dispatchImporter({id, docker, profile});
							blobsTryCount[id] = blobsTryCount[id] ? blobsTryCount[id] + 1 : 1;

							if (totalLimitAfterDispatch < 1) {
								logger.log('debug', 'Not processing further blobs because total container limit is exhausted');
								profilesExhausted.push(profileId);
								return;
							}
						}
					} else {
						logger.log('debug', `Cannot dispatch importer containers for blob ${id}. Maximum number of containers exhausted.`);
						profilesExhausted.push(profileId);
					}

					return doProcessing({blobs, profilesExhausted});
				}

				logger.log('debug', 'All blobs checked');

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

				async function getDispatchCount({id, import: {concurrency: importerConcurrencyOpt}}) {
					const importerConcurrency = typeof importerConcurrencyOpt === 'number' ? importerConcurrencyOpt : IMPORTER_CONCURRENCY;
					const total = (await docker.listContainers({
						filters: {
							label: ['fi.nationallibrary.melinda.record-import.container-type']
						}
					})).length;

					const importers = (await docker.listContainers({
						filters: {
							label: [
								'fi.nationallibrary.melinda.record-import.container-type=import-task',
								`profile=${id}`
							]
						}
					})).length;

					logger.log('debug', `Running import containers for profile ${id}: ${importers}/${importerConcurrency}. Running containers total: ${total}/${CONTAINER_CONCURRENCY}`);

					const availImporters = importerConcurrency - importers;
					const availTotal = CONTAINER_CONCURRENCY - total;

					if (availImporters > 0 && availTotal > 0) {
						if (availTotal > availImporters) {
							return {
								dispatch: true,
								totalLimitAfterDispatch: availImporters - 1
							};
						}

						return {
							dispatchCount: true,
							totalLimitAfterDispatch: availTotal - 1
						};
					}

					return {dispatchCount: 0};
				}

				async function dispatchImporter({id, docker, profile}) {
					logger.log('debug', "Dispatching importer")
					return Promise.all(map(async () => {
						try {
							await dispatchContainer({
								docker,
								type: 'import',
								blob: id,
								profile: profile.id,
								options: profile.import,
								template: CONTAINER_TEMPLATE_IMPORTER
							});
						} catch (err) {
							logError(err);
						}
					}));

					function map(cb) {
						return new Array(1).fill(0).map(cb);
					}
				}
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

		async function processCallback(blobs) {
			return Promise.all(blobs.map(async ({id}) => {
				try {
					await stopContainers({
						label: [
							'fi.nationallibrary.melinda.record-import.container-type',
							`blobId=${id}`
						]
					});
				} catch (err) {
					logError(err);
				}
			}));
		}
	}

	async function dispatchContainer({docker, type, blob, profile, options, template}) {
		const manifest = {
			Image: options.image,
			...clone(template)
		};

		manifest.Labels.blobId = blob;
		manifest.Labels.profile = profile;
		manifest.Env.push(`PROFILE_ID=${profile}`);
		manifest.Env.push(`BLOB_ID=${blob}`);

		getEnv(options.env).forEach(v => manifest.Env.push(v));

		const cont = await docker.createContainer(manifest);

		await attachToNetworks();

		try {
			await cont.start();
			const name = await getContainerName(cont);

			logger.log('info', `Started ${type} container ${name} (${cont.id})`);
		} catch (err) {
			logger.log('error', `Creation of ${type} container ${cont.id} has failed`);
			throw err;
		}

		async function getContainerName(cont) {
			const {Name} = await cont.inspect();
			return Name.replace(/^\//, '');
		}

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

		cache[id] = await client.getProfile({id});
		return cache[id];
	}
}
