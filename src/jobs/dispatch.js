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

/* eslint no-unused-expressions: 0 max-nested-callbacks: 0 */
'use strict';

const {expect} = require('chai');
const {Utils} = require('@natlibfi/melinda-commons');
const {createLogger} = Utils;

const Docker = require('dockerode');
const fetch = require('node-fetch');
const _ = require('lodash');
const config = require('../config-controller');

// ////////////////////////////////////////////////////////
// Start: Defining jobs to be activated from worker
module.exports = function (agenda) {
	const Logger = createLogger();
	const urlBlobs = `${config.urlAPI}/blobs`;
	const urlProfile = `${config.urlAPI}/profiles/`;
	const encodedAuth = `Basic ${Buffer.from(`${process.env.API_USERNAME}:${process.env.API_PASS}`).toString('base64')}`;
	const docker = new Docker();

	agenda.define(config.enums.JOBS.pollBlobsPending, (job, done) => {
		fetch(urlBlobs + '?state=' + config.enums.BLOB_STATE.pending, {headers: {Authorization: encodedAuth}})
			.then(res => {
				expect(res.status).to.equal(config.enums.HTTP_CODES.OK);
				return res.json();
			}).then(blobs => processBlobsPending(blobs, done))
			.catch(error => Logger.log('error', error));
	});

	agenda.define(config.enums.JOBS.pollBlobsTransformed, (job, done) => {
		fetch(urlBlobs + '?state=' + config.enums.BLOB_STATE.transformed, {headers: {Authorization: encodedAuth}})
			.then(res => {
				expect(res.status).to.equal(config.enums.HTTP_CODES.OK);
				return res.json();
			}).then(blobs => processBlobsImport(blobs, done))
			.catch(error => Logger.log('error', error));
	});

	agenda.define(config.enums.JOBS.pollBlobsAborted, (job, done) => {
		fetch(urlBlobs + '?state=' + config.enums.BLOB_STATE.aborted, {headers: {Authorization: encodedAuth}})
			.then(res => {
				expect(res.status).to.equal(config.enums.HTTP_CODES.OK);
				return res.json();
			})
			.then(json => processBlobsAborted(json, done))
			.catch(error => Logger.log('error', error));
	});

	agenda.define(config.enums.JOBS.checkContainerHealth, (job, done) => {
		const healthcheckPromise = checkHealthy();
		healthcheckPromise.then(() => {
			done();
		}).catch(error => {
			Logger.log('error', error);
		});
	});

	// Start: Defining jobs to be activated from worker
	// ////////////////////////////////////////////////////////

	// ////////////////////////////////////////////////////////
	// Start: Subfunctions for Pending blobs
	// Blob state is PENDING_TRANSFORMATION - This is provided as blobs
	// a. Retrieve the profile specified in blob metadata: GET /profiles/{id}
	// b. Dispatch a transformer container according to the profile
	// c. Call POST /profiles/{id} with status={blobStates.inProgress}
	function processBlobsPending(blobs, done) {
		Logger.log('debug', '* PENDING blobs to Process:', blobs);

		// Cycle trough each found blob
		const blobStartups = blobs.map(urlBlob => {
			return new Promise(resolve => {
				// A: Get profile to be used for containers
				const getProfilePromise = getBlobProfile(urlBlob);
				getProfilePromise.then(profile => { // This is profile
					Logger.log('debug', 'Starting TRANSFORMATION container');

					// B: Dispatch transformer container
					const dispatchTransformerPromise = dispatchTransformer(profile);
					dispatchTransformerPromise.then(result => {
						Logger.log('debug', 'Starting TRANSFORMATION container end, success:', result);

						// C: Update blob state trough API
						const data = {state: config.enums.BLOB_STATE.inProgress};
						fetch(urlBlob, {
							method: 'POST',
							body: JSON.stringify(data),
							headers: {
								Authorization: encodedAuth,
								'Content-Type': 'application/json',
								Accept: 'application/json'
							}
						})
							.then(res => {
								expect(res.status).to.equal(config.enums.HTTP_CODES.Updated);
								Logger.log('info', `Blob ${urlBlob} set to: ${data}`);

								resolve();
							})
							.catch(error => {
								Logger.log('error', error);
							});
					}).catch(error => {
						Logger.log('error', error);
					});
				}).catch(error => {
					Logger.log('error', error);
				});
			});
		});
		Promise.all(blobStartups).then(() => done());
	}

	function dispatchTransformer(profile) {
		return new Promise((resolve, reject) => {
			try {
				expect(profile.transformation.abortOnInvalidRecords).to.exist;
				expect(profile.transformation.image).to.exist;
				expect(profile.name).to.exist;
				expect(profile.blob).to.exist;
			} catch (error) {
				reject(error);
			}

			const transformer = _.cloneDeep(config.transformer);
			transformer.Image = profile.transformation.image;
			transformer.Labels.blobID = profile.blob;
			transformer.Env = [
				'ABORT_ON_INVALID_RECORDS=' + profile.transformation.abortOnInvalidRecords,
				'PROFILE_ID=' + profile.name,
				'BLOB_ID=' + profile.blob,
				'API_URL=' + config.urlAPI,
				'API_USERNAME=' + process.env.API_USERNAME,
				'API_PASSWORD=' + process.env.API_PASS,
				'AMQP_URL=' + config.AMQP_URL
			];
			docker.createContainer(transformer).then(cont => {
				return cont.start();
			}).then(cont => {
				Logger.log('info', 'ID of started TRANSFORMATION container:', cont.id);
				resolve(true);
			}).catch(error => {
				reject(error);
			});
		});
	}
	// End: Subfunctions for Pending blobs
	// ////////////////////////////////////////////////////////

	// ////////////////////////////////////////////////////////
	// Start: Subfunctions for Transformed blobs
	// Blob state is TRANSFORMED - This is provided as blobs
	// a. Retrieve the profile specified in blob metadata: GET /profiles/{id}
	// b. Dispatch importer containers according to the profile (import.image, import.env). The maximum number of containers to dispatch for a blob is specified by environment variable IMPORTER_CONCURRENCY (And the total maximum of all containers dispatched by the controller is specified by CONTAINERS_CONCURRENCY)
	function processBlobsImport(blobs, done) {
		Logger.log('debug', `* TRANSFORMED blobs to Process: ${blobs}`);

		const searchOptsImporters = {
			filters: '{"label": ["fi.nationallibrary.melinda.record-import.container-type=import-task"]}'
		};

		// Check total amount of running containers and set global CONTAINERS_CONCURRENCY limit (b)
		docker.listContainers(searchOptsImporters, (err, impContainers) => {
			let canStartGlobalCount = config.CONTAINERS_CONCURRENCY - impContainers.length;
			Logger.log('debug', `Running import containers: ${impContainers.length}, maximum: ${config.CONTAINERS_CONCURRENCY},  global limit allows to start: ${canStartGlobalCount}`);

			if (err) {
				Logger.log('error', err);
			}

			// Check that global concurrency limit is not exceeded
			if (impContainers.length < config.CONTAINERS_CONCURRENCY) {
				// Cycle trough each found blob in subfunction
				const goTroughEachBlobPromise = startContainersForEach(blobs, canStartGlobalCount);
				goTroughEachBlobPromise.then(() => {
					done();
				}).catch(error => {
					Logger.log('error', error);
				});
			} else {
				Logger.log('error', `Maximum number of jobs set in CONTAINERS_CONCURRENCY (${config.CONTAINERS_CONCURRENCY}) exceeded, running containers: ${impContainers.length}`);
				done();
			}
		});
	}

	// Go trough each found blob, check concurrency limits and figure out how many containers to launch
	function startContainersForEach(blobs, canStartGlobalCount) {
		return new Promise((resolve, reject) => {
			const blobStartups = blobs.map(urlBlob => {
				const searchOptsSingle = {
					filters: '{"label": ["fi.nationallibrary.melinda.record-import.container-type=import-task", "blobID=' + urlBlob.slice(urlBlob.lastIndexOf('/blobs/') + 7) + '"]}' // Slice should be ID, but...
				};

				return new Promise(resolve => {
					docker.listContainers(searchOptsSingle, (error, containers) => {
						if (error) {
							reject(error);
						}

						let canStartCount = config.IMPORTER_CONCURRENCY - containers.length;
						let containersToStart = (canStartCount > canStartGlobalCount) ? canStartGlobalCount : canStartCount;

						Logger.log('debug', `Running import containers for blob: ${containers.length}, maximum: ${config.IMPORTER_CONCURRENCY}, can start: ${canStartCount}, global limit: ${canStartGlobalCount}, will start: ${containersToStart}`);

						if (containersToStart > 0) {
							canStartGlobalCount -= containersToStart;

							const getProfilePromise = getBlobProfile(urlBlob);
							getProfilePromise.then(profile => {
								// Launch actual amount of containers for each specific blob
								const dispatchImporterPromise = dispatchImportersForBlob(profile, containersToStart);
								dispatchImporterPromise.then(result => {
									Logger.log('debug', `Starting IMPORT containers end, success: ${result}`);
									resolve();
								}).catch(error => {
									reject(error);
								});
							}).catch(error => {
								reject(error);
							});
						} else {
							console.info('Maximum number of containers running (now: ', containers.length, '/ max: ', config.IMPORTER_CONCURRENCY, ') for blob:', urlBlob, 'or total maximum global limit reached. (can still start: ', canStartGlobalCount, ' / max: ', config.CONTAINERS_CONCURRENCY, ')');
							resolve();
						}
					});
				});
			});
			Promise.all(blobStartups).then(() => resolve());
		});
	}

	// Dispact containers matching profile and amount specified in containersToStart
	function dispatchImportersForBlob(profile, containersToStart) {
		return new Promise((resolve, reject) => {
			try {
				expect(profile.transformation.abortOnInvalidRecords).to.exist;
				expect(profile.name).to.exist;
				expect(profile.blob).to.exist;
			} catch (error) {
				reject(error);
			}

			// Create containersToStart amount of promises to start container
			var requests = [];
			for (var i = 0; i < containersToStart; i++) {
				requests.push(new Promise(resolve => {
					const importer = _.cloneDeep(config.importer);
					importer.Image = profile.import.image;
					importer.Labels.blobID = profile.blob;
					importer.Env = [
						'PROFILE_ID=' + profile.name,
						'BLOB_ID=' + profile.blob,
						'API_URL=' + config.urlAPI,
						'API_USERNAME=' + process.env.CROWD_USERNAME,
						'API_PASSWORD=' + process.env.CROWD_PASS,
						'AMQP_URL=' + process.env.AMQP_URL
					];

					docker.createContainer(importer).then(cont => {
						return cont.start();
					}).then(cont => {
						Logger.log('info', `ID of started IMPORT container: ${cont.id}`);
						resolve();
					}).catch(error => {
						reject(error);
					});
				}));
			}

			Promise.all(requests).then(() => resolve(true)).catch(error => reject(error));
		});
	}
	// End: Subfunctions for Transformed blobs
	// ////////////////////////////////////////////////////////

	// ////////////////////////////////////////////////////////
	// Start: Subfunctions for Aborted blobs
	// Blob state is ABORTED
	// a. Terminate any importer containers for the blob
	function processBlobsAborted(blobs, done) {
		Logger.log('debug', `* ABORTED blobs to process: ${blobs}`);

		const blobAbort = blobs.map(urlBlob => {
			return new Promise(resolve => {
				const searchOpts = {
					filters: '{"label": ["fi.nationallibrary.melinda.record-import.container-type=import-task", "blobID=' + urlBlob.slice(urlBlob.lastIndexOf('/blobs/') + 7) + '"]}' // Slice should be ID, but...
				};

				// A: Terminate any importer containers for the blob
				docker.listContainers(searchOpts, (error, container) => {
					if (error) {
						console.error(error);
					}

					if (container.length === 1) {
						docker.getContainer(container[0].Id).stop(() => {
							Logger.log('debug', 'Container stopped');
							resolve();
						});
					} else {
						Logger.log('debug', `Blob (${urlBlob}) set as aborted; but found ${container.length} matching containers.`);
					}
				});
			});
		});
		Promise.all(blobAbort).then(() => done());
	}
	// End: Subfunctions for Aborted blobs
	// ////////////////////////////////////////////////////////

	// ////////////////////////////////////////////////////////
	// Start: Subfunctions for unhelthy containers
	//  i. Terminate containers for which a health check fails.
	// ii. Raise an alert about the termination
	function checkHealthy() {
		Logger.log('debug', '* HEALTHCHECK unhealthy containers');

		return new Promise((resolve, reject) => {
			docker.listContainers({filters: {health: ['unhealthy']}}, (err, containers) => {
				if (err) {
					reject(err);
				}

				if (containers === null) {
					resolve();
				} else {
					// Shut down unhealty containers
					const requests = containers.map(containerInfo => {
						return new Promise(resolve => {
							docker.getContainer(containerInfo.Id).stop(() => {
								console.error('Closed container:', containerInfo.Id);
								resolve();
							});
						});
					});

					Promise.all(requests).then(() => resolve()).catch(error => reject(error));
				}
			});
		});
	}
	// Start: Subfunctions for unhelty containers
	// ////////////////////////////////////////////////////////

	// ////////////////////////////////////////////////////////
	// Start: Supporting functions
	function getBlobProfile(urlBlob) {
		return new Promise((resolve, reject) => {
			Logger.log('debug', `Getting profile for: ${urlBlob}`);

			// Get Profilename from blob
			fetch(urlBlob, {headers: {Authorization: encodedAuth}})
				.then(res => {
					expect(res.status).to.equal(config.enums.HTTP_CODES.OK);
					return res.json();
				})
				.then(json => {
					expect(json).to.exist;
					expect(json).to.be.an('object');
					expect(json.profile).to.exist;
					expect(json.profile).to.be.an('string'); // This is used in following query
					expect(json.id).to.exist;
					expect(json.id).to.be.an('string'); // This is used in following resolve
					return json;
				})
			// Get Profile with profilename (ID)
				.then(blob => {
					const urlProfileLocal = urlProfile + blob.profile; // This is profile name
					fetch(urlProfileLocal, {headers: {Authorization: encodedAuth}})
						.then(res => {
							expect(res.status).to.equal(config.enums.HTTP_CODES.OK);
							return res.json();
						})
						.then(profile => {
							expect(profile).to.exist;
							expect(profile).to.be.an('object');
							profile.blob = blob.id; // Append profile with blob ID
							resolve(profile); // This is profile
						})
						.catch(error => reject(error));
				})
				.catch(error => reject(error));
		});
	}

	// / Some supporting functions not in use atm:
	// function removeContainers() {
	// 	return new Promise((resolveMain, reject) => {
	// 		docker.listContainers((error, containers) => {
	// 			if (error) {
	// 				console.error(error);
	// 			}

	//             // Shut down all previous containers
	// 			const requests = containers.map(containerInfo => {
	// 				return new Promise(resolve => {
	// 					docker.getContainer(containerInfo.Id).stop(() => {
	// 						resolve();
	// 					});
	// 				});
	// 			});

	// 			Promise.all(requests).then(() => resolveMain());
	// 		});
	// 	});
	// }

	// This is used to read logs from running containers, not used ATM
	// function containerLogs(container) {
	// 	const stream = require('stream');
	// 	if (container) {
	// 		// Create a single stream for stdin and stdout
	// 		const logStream = new stream.PassThrough();
	// 		logStream.on('data', chunk => {
	// 			console.log(chunk.toString('utf8'));
	// 		});

	// 		container.logs({
	// 			follow: true,
	// 			stdout: true,
	// 			stderr: true
	// 		}, (error, stream) => {
	// 			if (error) {
	// 				console.error(error.message);
	// 				// Return logger.error(error.message);
	// 			}

	// 			container.modem.demuxStream(stream, logStream, logStream);
	// 			stream.on('end', () => {
	// 				logStream.end('!Stream end');
	// 			});

	// 			setTimeout(() => {
	// 				stream.destroy();
	// 			}, 2000);
	// 		});
	// 	}
	// }
	// End: Supporting functions
	// ////////////////////////////////////////////////////////

	// var removeContainersPromise = removeContainers();
	// removeContainersPromise.then(function () {
	//     console.log('Promise remove resolved');
	// }).catch(function (error) {
	//     console.log('Promise remove rejected');
	//     return next(error);
	// });
};
