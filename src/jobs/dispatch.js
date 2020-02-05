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
import {Utils} from '@natlibfi/melinda-commons';
import {BLOB_STATE, createApiClient} from '@natlibfi/melinda-record-import-commons';
import {logError, processBlobs} from '../utils';

export default function (agenda, {
	listTasks, dispatchTask, terminateTasks,
	API_URL, API_USERNAME, API_PASSWORD,
	JOB_BLOBS_PENDING, JOB_BLOBS_TRANSFORMED, JOB_BLOBS_ABORTED,
	TASK_CONCURRENCY, IMPORTER_CONCURRENCY, TRANSFORMER_CONCURRENCY,
	IMPORTER_CONCURRENCY_BLOB,
	API_CLIENT_USER_AGENT, IMPORT_OFFLINE_PERIOD
}) {
	const {createLogger} = Utils;
	const logger = createLogger();
	const client = createApiClient({
		url: API_URL, username: API_USERNAME, password: API_PASSWORD,
		userAgent: API_CLIENT_USER_AGENT
	});

	agenda.define(JOB_BLOBS_PENDING, {}, blobsPending);
	agenda.define(JOB_BLOBS_TRANSFORMED, {}, blobsTransformed);
	agenda.define(JOB_BLOBS_ABORTED, {}, blobsAborted);

	async function blobsPending(_, done) {
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
							await dispatchTask({
								type: 'transform',
								blob: id,
								profile: profileId,
								options: transformationOptions
							});

							await client.updateState({id, state: BLOB_STATE.TRANSFORMATION_IN_PROGRESS});
							logger.log('info', `Transformation started for ${id} `);

							return dispatch(blobs.slice(1));
						}

						logger.log('warn', `Could not dispatch transformer for blob ${id} because total number of tasks is exhausted`);
						return dispatch(blobs.slice(1));
					} catch (err) {
						logError(err);
					}
				}

				async function canDispatch() {
					const totalCount = (await listTasks()).length;
					const transformCount = (await listTasks({type: 'transform'})).length;

					console.log(`TOTAL COUNT:${totalCount}`);
					console.log(`TRANSFORMER COUNT:${transformCount}`);

					return transformCount < TRANSFORMER_CONCURRENCY && totalCount < TASK_CONCURRENCY;
				}
			}
		}
	}

	async function blobsTransformed({attrs: {data: blobsTryCount}}, done) {
		const profileCache = {};

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

		async function processCallback(blobs) {
			Object.keys(blobsTryCount).forEach(({id}) => {
				if (blobs.some(({id: otherId}) => otherId === id)) {
					return;
				}

				delete blobsTryCount[id];
			});

			doProcessing({blobs});

			async function doProcessing({blobs, profilesExhausted = []}) {
				const blob = blobs.shift();

				if (blob) {
					const {numberOfRecords, processedRecords, failedRecords, id, profile: profileId} = blob;

					if (numberOfRecords === processedRecords + failedRecords) {
						logger.log('debug', `All records of blob ${id} have been processed. Setting state to PROCESSED`);
						await client.updateState({id, state: BLOB_STATE.PROCESSED});
						return doProcessing({blobs, profilesExhausted});
					}

					if (profilesExhausted.includes(profileId)) {
						return doProcessing({blobs, profilesExhausted});
					}

					const profile = await getProfile(profileId, profileCache);
					const {dispatchCount, canDispatchMore} = await getDispatchCount(profile.id);

					logger.log('debug', `Importer task status for profile ${id}: Can dispatch ${dispatchCount}. Can dispatch more: ${canDispatchMore}`);

					if (dispatchCount > 0) {
						if (isOfflinePeriod()) {
							logger.log('debug', 'Not dispatching importers during offline period');
							return;
						}

						logger.log('debug', `Dispatching ${dispatchCount} import tasks for blob ${id}`);
						await dispatchImporters({id, dispatchCount, profile});

						blobsTryCount[id] = blobsTryCount[id] ? blobsTryCount[id] + 1 : 1;

						if (canDispatchMore === false) {
							logger.log('debug', 'Not processing further blobs because total task limit is exhausted');
							return;
						}

						return doProcessing({blobs, profilesExhausted});
					}

					logger.log('debug', `Cannot dispatch importer tasks for blob ${id}. Maximum number of tasks exhausted.`);
					profilesExhausted.push(profileId);

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

				async function getDispatchCount(id) {
					const totalCount = (await listTasks()).length;
					const importerCount = (await listTasks({type: 'import'})).length;
					const blobImporterCount = (await listTasks({type: 'import', profile: id})).length;

					if (blobImporterCount < IMPORTER_CONCURRENCY_BLOB && importerCount < IMPORTER_CONCURRENCY && totalCount < TASK_CONCURRENCY) {
						const dispatchCount = calculateCount(totalCount, importerCount, blobImporterCount);
						const canDispatchMore = dispatchCount < IMPORTER_CONCURRENCY_BLOB && dispatchCount < IMPORTER_CONCURRENCY && dispatchCount < TASK_CONCURRENCY;

						return {dispatchCount, canDispatchMore};
					}

					return {dispatchCount: 0, canDispatchMore: false};

					function calculateCount() {
						const leftTotal = TASK_CONCURRENCY - totalCount;
						const leftImporters = IMPORTER_CONCURRENCY - importerCount;
						const leftBlobImporters = IMPORTER_CONCURRENCY_BLOB - blobImporterCount;

						const importerLimit = getImporterLimit();
						const totalResult = importerLimit - leftTotal;

						if (totalResult <= 0) {
							return importerLimit;
						}

						return 1;

						function getImporterLimit() {
							const limit = leftBlobImporters - leftImporters;

							if (limit <= 0) {
								return leftBlobImporters;
							}

							return 1;
						}
					}
				}

				async function dispatchImporters({id, dispatchCount, profile}) {
					return Promise.all(map(async () => {
						try {
							await dispatchTask({
								type: 'import',
								blob: id,
								profile: profile.id,
								options: profile.import
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
					await terminateTasks({blob: id});
				} catch (err) {
					logError(err);
				}
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
