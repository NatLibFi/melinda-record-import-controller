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
import {Utils} from '@natlibfi/melinda-commons';
import {BLOB_STATE, createApiClient} from '@natlibfi/melinda-record-import-commons';
import {
	API_URL, API_USERNAME, API_PASSWORD,
	CONTAINER_TEMPLATE_TRANSFORMER, CONTAINER_TEMPLATE_IMPORTER,
	JOB_BLOBS_PENDING, JOB_BLOBS_TRANSFORMED, JOB_BLOBS_ABORTED, JOB_CONTAINERS_HEALTH,
	CONTAINERS_CONCURRENCY, IMPORTER_CONCURRENCY
} from '../config';

const {createLogger} = Utils;

export default function (agenda) {
	const Logger = createLogger();
	const docker = new Docker();
	const ApiClient = createApiClient({url: API_URL, username: API_USERNAME, password: API_PASSWORD});

	agenda.define(JOB_BLOBS_PENDING, blobsPending);
	agenda.define(JOB_BLOBS_TRANSFORMED, blobsTransformed);
	agenda.define(JOB_BLOBS_ABORTED, blobsAborted);
	agenda.define(JOB_CONTAINERS_HEALTH, containersHealth);

	async function blobsPending(_, done) {		
		const blobs = await ApiClient.blobsQuery({state: BLOB_STATE.pending});
		await processBlobs();
		done();

		async function processBlobs() {	
			Logger.log('debug', `{blobs.length} are pending transformation.`);		
			return Promise.all(blobs.map(async blob => {
				try {
					const profile = await getBlobProfile(blob);
					Logger.log('debug', 'Starting TRANSFORMATION container');

					if (await canDispatch()) {
						await dispatchContainer({
							blob,
							profile: profile.name,
							options: profile.transformation,
							template: CONTAINER_TEMPLATE_TRANSFORMER
						});

						await ApiClient.setTransformationStarted(blob);
						Logger.log('info', `Transformation started for ${blob} `);
					} else {
						Logger.log('warn', `Could not dispatch transformer for blob ${blob} because total number of containers is exhausted`);
					}
				} catch (err) {
					Logger.log('err', err);
				}

				async function canDispatch() {
					const runningContainers = await docker.listContainers({
						filters: {
							label: ['fi.nationallibrary.melinda.record-import.container-type']
						}
					}).length;

					return runningContainers.length < CONTAINERS_CONCURRENCY;
				}
			}));
		}
	}

	async function blobsTransformed(_, done) {
		const blobs = await ApiClient.blobQuery({state: BLOB_STATE.transformed});
		Logger.log('debug', `${blobs} blobs are waiting to be imported.`);
		await processBlobs();
		done();

		async function processBlobs() {
			const blob = blobs.shift();
			const profile = await getBlobProfile(blob);

			if (blob) {
				const dispatchCount = await getDispatchCount();

				if (dispatchCount > 0) {
					Logger.log('debug', `Dispatching ${dispatchCount} import containers for blob ${blob}`);
					await dispatchImporters(dispatchCount);
				} else {
					Logger.log('warn', `Cannot dispatch importer containers for blob ${blob}. Maximum number of containers exhausted.`);
				}

				return processBlobs();
			}

			async function getDispatchCount() {
				const total = await docker.listContainers({
					filters: {
						label: ['fi.nationallibrary.melinda.record-import.container-type']
					}
				}).length;

				const importers = await docker.listContainers({
					filters: {
						label: [
							'fi.nationallibrary.melinda.record-import.container-type=import-task',
							`blobID=${blob}`
						]
					}
				}).length;

				Logger.log('debug', `Running import containers for blob ${blob}: ${importers}/${IMPORTER_CONCURRENCY}. Running containers total: ${total}/${CONTAINERS_CONCURRENCY}`);

				const availImporters = IMPORTER_CONCURRENCY - importers;
				const availTotal = CONTAINERS_CONCURRENCY - total;
				const avail = availTotal - availImporters;

				return avail > 0 ? avail : 0;
			}

			async function dispatchImporters(count) {
				return Promise.all(map(async () => {
					try {
						await dispatchContainer({
							blob,
							profile: profile.name,
							options: profile.import,
							template: CONTAINER_TEMPLATE_IMPORTER
						});
					} catch (err) {
						Logger.log('error', err);
					}
				}));

				function map(cb) {
					return new Array(count).fill(0).map(cb);
				}
			}
		}
	}

	async function blobsAborted(_, done) {
		const blobs = await ApiClient.blobQuery({state: BLOB_STATE.aborted});		
		await processBlobs();
		done();

		async function processBlobs() {
			Logger.log('debug', `${blobs} have been aborted`);
			return Promise.all(blobs.map(async blob => {
				try {
					const containers = await docker.listContainers({
						filters: {
							label: [
								'fi.nationallibrary.melinda.record-import.container-type',
								`blobID=${blob}`
							]
						}
					});

					Logger.log('debug', `Stopping ${containers.length} containers because blob ${blob} state is set to ABORTED.`);

					await Promise.all(containers.map(async container => {
						try {
							await docker.getContainer(container.id).stop();
						} catch (err) {
							Logger.log('error', err);
						}
					}));
				} catch (err) {
					Logger.log('err', err);
				}
			}));
		}
	}

	async function containersHealth(_, done) {		
		const containers = await docker.listContainers({
			filters: {
				health: ['unhealthy'],
				label: ['fi.nationallibrary.melinda.record-import.container-type']
			}
		});

		if (containers.length > 0) {
			Logger.log('debug', `${containers.length} containers are unhealthy and need to be stopped.`);

			await Promise.all(containers.map(async container => {
				try {
					await docker.getContainer(container.id).stop();
				} catch (err) {
					Logger.log('error', err);
				}
			}));
	
		}
				
		done();
	}

	async function getBlobProfile(blob) {
		const metadata = await ApiClient.getBlobMetadata(blob);
		return ApiClient.getProfile(metadata.profile);
	}

	async function dispatchContainer({blob, profile, options, template}) {
		const manifest = {
			Image: options.image,
			...template
		};

		manifest.Labels.blobId = blob;
		manifest.transformer.env.push(`PROFILE_ID=${profile}`);
		manifest.transformer.env.push(`BLOB_ID=${blob}`);

		getEnv(options.env).forEach(v => manifest.env.push(v));

		const cont = await docker.createContainer(manifest);
		const info = await cont.start();

		Logger.log('info', `ID of started container: ${info.id}`);

		function getEnv(env = {}) {
			return Object.keys(env).map(k => `${k}=${env[k]}`);
		}
	}
}
