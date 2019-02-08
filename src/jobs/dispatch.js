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

const {logs} = config;
const {expect} = require('chai').expect;
const Docker = require('dockerode');
const fetch = require('node-fetch');
const _ = require('lodash');
const config = require('../config-controller');

const urlBlobs = config.urlAPI + '/blobs';
const urlProfile = config.urlAPI + '/profiles/';
const encodedAuth = 'Basic ' + Buffer.from(process.env.CROWD_USERNAME + ':' + process.env.CROWD_PASS).toString('base64');

const docker = new Docker();

// ////////////////////////////////////////////////////////
// Start: Defining jobs to be activated from worker
module.exports = function (agenda) {
	agenda.define(config.jobs.pollBlobsPending, (job, done) => {
		fetch(urlBlobs + '?state=' + config.blobStates.pending, {headers: {Authorization: encodedAuth}})
			.then(res => {
				expect(res.status).to.equal(config.httpCodes.OK);
				return res.json();
			}).then(blobs => processBlobsPending(blobs))
			.then(done())
			.catch(error => console.error(error));
	});

	agenda.define(config.jobs.pollBlobsTransformed, (job, done) => {
		fetch(urlBlobs + '?state=' + config.blobStates.transformed, {headers: {Authorization: encodedAuth}})
			.then(res => {
				expect(res.status).to.equal(config.httpCodes.OK);
				return res.json();
			}).then(blobs => processBlobsTransformed(blobs))
			.then(done())
			.catch(error => console.error(error));
	});

	agenda.define(config.jobs.pollBlobsAborted, (job, done) => {
		fetch(urlBlobs + '?state=' + config.blobStates.aborted, {headers: {Authorization: encodedAuth}})
			.then(res => {
				expect(res.status).to.equal(config.httpCodes.OK);
				return res.json();
			}).then(json => processBlobsAborted(json))
			.then(done())
			.catch(error => console.error(error));
	});
};
// Start: Defining jobs to be activated from worker
// ////////////////////////////////////////////////////////

// ////////////////////////////////////////////////////////
// Start: Subfunctions for Pending blobs
// Blob state is PENDING_TRANSFORMATION - This is provided as blobs
// a. Retrieve the profile specified in blob metadata: GET /profiles/{id}
// b. Dispatch a transformer container according to the profile
// c. Call POST /profiles/{id} with op=transformationStarted
function processBlobsPending(blobs) {
	if (logs) {
		console.log('Pending blobs to Process:', blobs);
	}

	// Cycle trough each found blob
	_.forEach(blobs, urlBlob => {
		// A: Get profile to be used for containers
		const getProfilePromise = getBlobProfile(urlBlob);
		getProfilePromise.then(profile => { // This is profile name
			if (logs) {
				console.log('Starting TRANSFORMATION container');
			}

			// B: Dispatch transformer container
			const dispatchTransformerPromise = dispatchTransformer(profile);
			dispatchTransformerPromise.then(result => {
				if (logs) {
					console.log('Starting TRANSFORMATION container end, success:', result);
				}

				// C: Update blob state trough API
				const data = {state: config.blobStates.inProgress};
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
						expect(res.status).to.equal(config.httpCodes.Updated);
						if (logs) {
							console.log('Blob set to:', data);
						}
					})
					.catch(error => {
						console.error(error);
					});
			}).catch(error => {
				console.error(error);
			});
		}).catch(error => {
			console.error(error);
		});
	});
}

function dispatchTransformer(profile) {
	return new Promise((resolve, reject) => {
		expect(profile.transformation.abortOnInvalidRecords).to.be.not.null;
		expect(profile.name).to.be.not.null;
		expect(profile.blob).to.be.not.null;

		const transformer = _.cloneDeep(config.transformer);
		transformer.Image = profile.transformation.image;
		transformer.Labels.blobID = profile.blob;
		transformer.Env = [
			'ABORT_ON_INVALID_RECORDS=' + profile.transformation.abortOnInvalidRecords,
			'PROFILE_ID=' + profile.name,
			'BLOB_ID=' + profile.blob,
			'API_URL=' + config.urlAPI,
			'API_USERNAME=' + process.env.CROWD_USERNAME,
			'API_PASSWORD=' + process.env.CROWD_PASS,
			'AMQP_URL=' + config.AMQP_URL
		];

		docker.createContainer(
			transformer
		).then(cont => {
			return cont.start();
		}).then(cont => {
			console.log('Container started:', cont);
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
// a. If the are no running importer containers for the blob, retrieve the profile specified in blob metadata: GET /profiles/{id}
// b. Dispatch importer containers according to the profile. The maximum number of containers to dispatch is specified by environment variable IMPORTER_CONCURRENCY
// c. Call POST /blobs/{id} with op=TRANSFORMATION_IN_PROGRESS
function processBlobsTransformed(blobs) {
	if (logs) {
		console.log('Transformed blobs to Process:', blobs);
	}

	const searchOptsImporters = {
		filters: '{"label": ["fi.nationallibrary.melinda.record-import.container-type=import-task"]}'
	};

	docker.listContainers(searchOptsImporters, (error, impContainers) => {
		if (logs) {
			console.log('Running import containers:', impContainers.length, 'maximum:', config.IMPORTER_CONCURRENCY);
		}

		if (error) {
			console.error(error);
		}

		if (impContainers.length < config.IMPORTER_CONCURRENCY) {
			// Cycle trough each found blob
			_.forEach(blobs, urlBlob => {
				const searchOptsSingle = {
					filters: '{"label": ["fi.nationallibrary.melinda.record-import.container-type=import-task", "blobID=' + urlBlob.slice(urlBlob.lastIndexOf('/blobs/') + 7) + '"]}' // Slice should be ID, but...
				};

				// A: If the are no running importer containers, get profile to be used for containers
				docker.listContainers(searchOptsSingle, (error, containers) => {
					if (error) {
						console.error(error);
					}

					if (containers.length === 0) {
						const getProfilePromise = getBlobProfile(urlBlob);
						getProfilePromise.then(profile => {
							if (logs) {
								console.log('Starting IMPORT container');
							}

							// B: Dispatch importer container
							const dispatchImporterPromise = dispatchImporter(profile);
							dispatchImporterPromise.then(result => {
								if (logs) {
									console.log('Starting container end, success:', result);
								}

								// C: Update blob state trough API
								const data = {state: config.blobStates.inProgress};
								fetch(urlBlob, {
									method: 'POST',
									body: JSON.stringify(data),
									headers: {
										Authorization: encodedAuth,
										'Content-Type': 'application/json',
										Accept: 'application/json'
									}
								}).then(res => {
									expect(res.status).to.equal(config.httpCodes.Updated);
									if (logs) {
										console.log('Blob set to:', data);
									}
								}).catch(error => {
									console.error(error);
								});
							}).catch(error => {
								console.error(error);
							});
						}).catch(error => {
							console.error(error);
						});
					} else {
						console.error('There is already container running for blob:', urlBlob);
					}
				});
			});
		} else {
			console.error('Maximum number of jobs set in IMPORTER_CONCURRENCY (', config.IMPORTER_CONCURRENCY, ') exceeded, running containers:', impContainers);
		}
	});
}

function dispatchImporter(profile) {
	return new Promise((resolve, reject) => {
		expect(profile.transformation.abortOnInvalidRecords).to.be.not.null;
		expect(profile.name).to.be.not.null;
		expect(profile.blob).to.be.not.null;

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

		docker.createContainer(
			importer
		).then(cont => {
			return cont.start();
		}).then(cont => {
			console.log('Container started:', cont);
			resolve(true);
		}).catch(error => {
			reject(error);
		});
	});
}
// End: Subfunctions for Transformed blobs
// ////////////////////////////////////////////////////////

// ////////////////////////////////////////////////////////
// Start: Subfunctions for Aborted blobs
// Blob state is ABORTED
// a. Terminate any importer containers for the blob
function processBlobsAborted(blobs) {
	if (logs) {
		console.log('Aborted blobs to process:', blobs);
	}

	_.forEach(blobs, urlBlob => {
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
					if (logs) {
						console.log('Container stopped');
					}
				});
			} else if (logs) {
				console.log('Blob (', urlBlob, ') set as aborted; but found', container.length, 'matching containers.');
			}
		});
	});
}
// End: Subfunctions for Aborted blobs
// ////////////////////////////////////////////////////////

// ////////////////////////////////////////////////////////
// Start: Supporting functions
function getBlobProfile(urlBlob) {
	return new Promise((resolve, reject) => {
		// Get Profilename from blob
		fetch(urlBlob, {headers: {Authorization: encodedAuth}})
			.then(res => {
				expect(res.status).to.equal(config.httpCodes.OK);
				return res.json();
			})
			.then(json => {
				expect(json).to.be.not.null;
				expect(json).to.be.an('object');
				expect(json.profile).to.be.not.null;
				expect(json.profile).to.be.an('string'); // This is used in following query
				expect(json.UUID).to.be.not.null;
				expect(json.UUID).to.be.an('string'); // This is used in following resolve
				return json;
			})
		// Get Profile with profilename (ID)
			.then(blob => {
				const urlProfileLocal = urlProfile + blob.profile; // This is profile name
				fetch(urlProfileLocal, {headers: {Authorization: encodedAuth}})
					.then(res => {
						expect(res.status).to.equal(config.httpCodes.OK);
						return res.json();
					})
					.then(profile => {
						expect(profile).to.be.not.null;
						expect(profile).to.be.an('object');
						profile.blob = blob.UUID; // Append profile with blob ID
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
//  const stream = require('stream');
// 	if (container) {
//         // Create a single stream for stdin and stdout
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
// 				return logger.error(error.message);
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
