/**

*
* @licstart  The following is the entire license notice for the JavaScript code in this file. 
*
* Controller microservice of Melinda record batch import system
*
* Copyright (C) 2018 University Of Helsinki (The National Library Of Finland)
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

/* eslint-disable no-unused-vars */

'use strict';

import {configurationGeneral as config} from '@natlibfi/melinda-record-import-commons';

var fetch = require('node-fetch'),
    logs = config.logs,
    _ = require('lodash'),
    chai = require('chai'),
    expect = chai.expect,
    Docker = require('dockerode'),
    stream = require('stream'); 
   
var configCtr = require('../config-controller');

const urlBlobs = config.urlAPI + '/blobs',
      urlProfile = config.urlAPI + '/profiles/',
      encodedAuth = 'Basic ' + Buffer.from(process.env.CROWD_USERNAME + ':' + process.env.CROWD_PASS).toString('base64');

var docker = new Docker();


//////////////////////////////////////////////////////////
// Start: Defining jobs to be activated from worker
module.exports = function (agenda) {
    agenda.define(config.enums.jobs.pollBlobsPending, function (job, done) {
        fetch(urlBlobs + '?state=' + config.enums.blobStates.pending, { headers: { 'Authorization': encodedAuth } })
        .then(res => {
            expect(res.status).to.equal(config.httpCodes.OK);
            return res.json();
        })
        .then(blobs => processBlobsPending(blobs))
        .then(done())
        .catch(err => console.error(err));
    });

    agenda.define(config.enums.jobs.pollBlobsTransformed, function (job, done) {
        fetch(urlBlobs + '?state=' + config.enums.blobStates.transformed, { headers: { 'Authorization': encodedAuth } })
        .then(res => {
            expect(res.status).to.equal(config.httpCodes.OK);
            return res.json();
        })
        .then(blobs => processBlobsTransformed(blobs))
        .then(done())
        .catch(err => console.error(err));
    });

    agenda.define(config.enums.jobs.pollBlobsAborted, function (job, done) {
        fetch(urlBlobs + '?state=' + config.enums.blobStates.aborted, { headers: { 'Authorization': encodedAuth } })
        .then(res => {
            expect(res.status).to.equal(config.httpCodes.OK);
            return res.json();
        })
        .then(json => processBlobsAborted(json))
        .then(done())
        .catch(err => console.error(err));
    });
}
// Start: Defining jobs to be activated from worker
//////////////////////////////////////////////////////////


//////////////////////////////////////////////////////////
// Start: Subfunctions for Pending blobs
// Blob state is PENDING_TRANSFORMATION - This is provided as blobs
// a. Retrieve the profile specified in blob metadata: GET /profiles/{id}
// b. Dispatch a transformer container according to the profile
// c. Call POST /profiles/{id} with op=transformationStarted
function processBlobsPending(blobs) {
    if (logs) console.log('Pending blobs to Process: ', blobs);

    //Cycle trough each found blob
    _.forEach(blobs, function (urlBlob) {
        //a: Get profile to be used for containers
        var getProfilePromise = getBlobProfile(urlBlob);
        getProfilePromise.then(function (profile) { //This is profile name
            if (logs) console.log('Starting TRANSFORMATION container');
            //b: Dispatch transformer container
            var dispatchTransformerPromise = dispatchTransformer(profile);
            dispatchTransformerPromise.then(function (result) {
                if (logs) console.log('Starting TRANSFORMATION container end, success: ', result);

                //c: Update blob state trough API
                var data = { state: config.enums.blobStates.inProgress };
                fetch(urlBlob, {
                    method: 'POST',
                    body: JSON.stringify(data),
                    headers: {
                        'Authorization': encodedAuth,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                })
                .then(res => {
                    expect(res.status).to.equal(config.httpCodes.Updated);
                    if (logs) console.log('Blob set to: ', data);
                })
                .catch(function (err) {
                    console.error(err);
                });
            }).catch(function (err) {
                console.error(err);
            });
        }).catch(function (err) {
            console.error(err);
        });
    });
}

function dispatchTransformer(profile) {
    return new Promise(function (resolve, reject) {
        expect(profile.transformation.abortOnInvalidRecords).to.be.not.null;
        expect(profile.name).to.be.not.null;
        expect(profile.blob).to.be.not.null;

        var transformer = _.cloneDeep(configCtr.transformer);
        transformer.Image = profile.transformation.image;
        transformer.Labels.blobID = profile.blob;
        transformer.Env = [
            'ABORT_ON_INVALID_RECORDS=' + profile.transformation.abortOnInvalidRecords,
            'PROFILE_ID=' + profile.name,
            'BLOB_ID=' + profile.blob,
            'API_URL=' + config.urlAPI,
            'API_USERNAME=' + process.env.CROWD_USERNAME,
            'API_PASSWORD=' + process.env.CROWD_PASS,
            'AMQP_URL=' + process.env.AMQP_URL
        ];

        docker.createContainer(
            transformer
        ).then(function (cont) {
            return cont.start();
        }).then(function (cont) {
            resolve(true);
        }).catch(function (err) {
            reject(err);
        });
    });
}
// End: Subfunctions for Pending blobs
//////////////////////////////////////////////////////////


//////////////////////////////////////////////////////////
// Start: Subfunctions for Transformed blobs
// Blob state is TRANSFORMED - This is provided as blobs
// a. If the are no running importer containers for the blob, retrieve the profile specified in blob metadata: GET /profiles/{id}
// b. Dispatch importer containers according to the profile. The maximum number of containers to dispatch is specified by environment variable IMPORTER_CONCURRENCY
// c. Call POST /blobs/{id} with op=TRANSFORMATION_IN_PROGRESS 
function processBlobsTransformed(blobs) {
    if (logs) console.log('Transformed blobs to Process: ', blobs);
    var searchOptsImporters = {
        'filters': '{"label": ["fi.nationallibrary.melinda.record-import.container-type=import-task"]}'
    };

    docker.listContainers(searchOptsImporters, function (err, impContainers) {
        if (logs) console.log('Running import containers: ', impContainers.length, ' maximum: ', configCtr.IMPORTER_CONCURRENCY);
        if (impContainers.length < configCtr.IMPORTER_CONCURRENCY) {
            //Cycle trough each found blob
            _.forEach(blobs, function (urlBlob) {
                var searchOptsSingle = {
                    'filters': '{"label": ["fi.nationallibrary.melinda.record-import.container-type=import-task", "blobID=' + urlBlob.slice(urlBlob.lastIndexOf("/blobs/") + 7) + '"]}' //slice should be ID, but...
                };

                //a: If the are no running importer containers, get profile to be used for containers
                docker.listContainers(searchOptsSingle, function (err, containers) {
                    if (containers.length === 0) {
                        var getProfilePromise = getBlobProfile(urlBlob);
                        getProfilePromise.then(function (profile) {
                            if (logs) console.log('Starting IMPORT container');

                            //b: Dispatch importer container
                            var dispatchImporterPromise = dispatchImporter(profile);
                            dispatchImporterPromise.then(function (result) {
                                if (logs) console.log('Starting container end, success: ', result);

                                //c: Update blob state trough API
                                var data = { state: config.enums.blobStates.inProgress };
                                fetch(urlBlob, {
                                    method: 'POST',
                                    body: JSON.stringify(data),
                                    headers: {
                                        'Authorization': encodedAuth,
                                        'Content-Type': 'application/json',
                                        'Accept': 'application/json'
                                    }
                                })
                                .then(res => {
                                    expect(res.status).to.equal(config.httpCodes.Updated);
                                    if (logs) console.log('Blob set to: ', data);
                                })
                                .catch(function (err) {
                                    console.error(err);
                                });
                            }).catch(function (err) {
                                console.error(err);
                            });
                        }).catch(function (err) {
                            console.error(err);
                        });
                    } else {
                        console.error('There is already container running for blob: ', urlBlob);
                    }
                });
            });
        } else {
            console.error('Maximum number of jobs set in IMPORTER_CONCURRENCY (', configCtr.IMPORTER_CONCURRENCY, ') exceeded, running containers: ', impContainers);
        }
    });
}

function dispatchImporter(profile) {
    return new Promise(function (resolve, reject) {
        expect(profile.transformation.abortOnInvalidRecords).to.be.not.null;
        expect(profile.name).to.be.not.null;
        expect(profile.blob).to.be.not.null;

        var importer = _.cloneDeep(configCtr.importer);
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
        ).then(function (cont) {
            return cont.start();
        }).then(function (cont) {
            resolve(true);
        }).catch(function (err) {
            reject(err);
        });
    });
}
// End: Subfunctions for Transformed blobs
//////////////////////////////////////////////////////////


//////////////////////////////////////////////////////////
// Start: Subfunctions for Aborted blobs
// Blob state is ABORTED
// a. Terminate any importer containers for the blob
function processBlobsAborted(blobs) {
    if (logs) console.log('Aborted blobs to process: ', blobs);

    _.forEach(blobs, function (urlBlob) {
        var searchOpts = {
            'filters': '{"label": ["fi.nationallibrary.melinda.record-import.container-type=import-task", "blobID=' + urlBlob.slice(urlBlob.lastIndexOf("/blobs/") + 7) + '"]}' //slice should be ID, but...
        };

        //a: Terminate any importer containers for the blob
        docker.listContainers(searchOpts, function (err, container) {
            if (container.length === 1) {
                docker.getContainer(container[0].Id).stop(function () {
                    if (logs) console.log('Container stopped');
                });
            } else {
                if (logs) console.log('Blob (', urlBlob, ') set as aborted; but found ', container.length, ' matching containers.')
            }
        });
    });
}
// End: Subfunctions for Aborted blobs
//////////////////////////////////////////////////////////


//////////////////////////////////////////////////////////
// Start: Supporting functions
function getBlobProfile(urlBlob) {
    return new Promise(function (resolve, reject) {
        //Get Profilename from blob
        fetch(urlBlob, { headers: { 'Authorization': encodedAuth } })
        .then(res => {
            expect(res.status).to.equal(config.httpCodes.OK);
            return res.json();
        })
        .then(json => {
            expect(json).to.be.not.null;
            expect(json).to.be.an('object');
            expect(json.profile).to.be.not.null;
            expect(json.profile).to.be.an('string'); //This is used in following query
            expect(json.UUID).to.be.not.null;
            expect(json.UUID).to.be.an('string'); //This is used in following resolve
            return json; 
        })
        //Get Profile with profilename (ID)
        .then(blob => {
            var urlProfileLocal = urlProfile + blob.profile; //This is profile name
            fetch(urlProfileLocal, { headers: { 'Authorization': encodedAuth } })
            .then(res => {
                expect(res.status).to.equal(config.httpCodes.OK);
                return res.json();
            })
            .then(profile => {
                expect(profile).to.be.not.null;
                expect(profile).to.be.an('object');
                profile.blob = blob.UUID; //Append profile with blob ID
                resolve(profile); //This is profile
            })
            .catch(err => reject(err));
        })
        .catch(err => reject(err));
    })
}

function removeContainers() {
    return new Promise(function (resolveMain, reject) {
        docker.listContainers(function (err, containers) {
            //Shut down all previous containers
            let requests = containers.map((containerInfo) => {
                return new Promise((resolve) => {
                    docker.getContainer(containerInfo.Id).stop(function () {
                        resolve();
                    });
                });
            })

            Promise.all(requests).then(() => resolveMain());
        });
    });
}

//This is used to read logs from running containers, not used ATM
function containerLogs(container) {
    if (container) {
        // create a single stream for stdin and stdout
        var logStream = new stream.PassThrough();
        logStream.on('data', function (chunk) {
            console.log(chunk.toString('utf8'));
        });

        container.logs({
            follow: true,
            stdout: true,
            stderr: true
        }, function (err, stream) {
            if (err) {
                return logger.error(err.message);
            }
            container.modem.demuxStream(stream, logStream, logStream);
            stream.on('end', function () {
                logStream.end('!Stream end');
            });

            setTimeout(function () {
                stream.destroy();
            }, 2000);
        });
    }
}
// End: Supporting functions
//////////////////////////////////////////////////////////

// var removeContainersPromise = removeContainers();
// removeContainersPromise.then(function () {
//     console.log('Promise remove resolved');
// }).catch(function (err) {
//     console.log('Promise remove rejected');
//     return next(err);
// });