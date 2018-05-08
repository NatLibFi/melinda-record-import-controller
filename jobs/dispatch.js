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
var fetch = require('node-fetch'),
    _ = require('lodash'),
    chai = require('chai'),
    expect = chai.expect;

var enums = require('../../melinda-record-import-commons/utils/enums'),
    config = require('../../melinda-record-import-commons/config'),
    configCrowd = require('../../melinda-record-import-commons/configCrowd');

var urlBlobs = config.urlAPI + '/blobs';

//////////////////////////////////////////////////////////
// Start: Defining jobs to be activated from worker
module.exports = function (agenda) {
    agenda.define(enums.jobs.pollBlobsPending, function (job, done) {
        fetch(urlBlobs + '?state=' + enums.blobStates.pending, { headers: { 'Authorization': configCrowd.encodedAuth } })
        .then(res => {
            expect(res.status).to.equal(200);
            return res.json();
        })
        .then(json => processBlobsPending(json))
        .then(done())
        .catch(err => console.error(err));
    });

    agenda.define(enums.jobs.pollBlobsTransformed, function (job, done) {
        fetch(urlBlobs + '?state=' + enums.blobStates.transformed, { headers: { 'Authorization': configCrowd.encodedAuth } })
        .then(res => {
            expect(res.status).to.equal(200);
            return res.json();
        })
        .then(json => processBlobs(json))
        .then(done())
        .catch(err => console.error(err));
    });

    agenda.define(enums.jobs.pollBlobsAborted, function (job, done) {
        fetch(urlBlobs + '?state=' + enums.blobStates.aborted, { headers: { 'Authorization': configCrowd.encodedAuth } })
        .then(res => {
            expect(res.status).to.equal(200);
            return res.json();
        })
        .then(json => processBlobs(json))
        .then(done())
        .catch(err => console.error(err));
    });
}
// Start: Defining jobs to be activated from worker
//////////////////////////////////////////////////////////


//////////////////////////////////////////////////////////
// Start: Subfunctions for Pending blobs
// Blob state is PENDING_TRANSFORMATION
// a. Retrieve the profile specified in blob metadata: GET /profiles/{id}
// b. Dispatch a transformer container according to the profile
// c. Call POST /profiles/{id} with op=transformationStarted
function processBlobsPending(blobs) {
    console.log("Processed blobs: ", blobs);

    _.forEach(blobs, function (urlBlob) {
        var getProfilePromise = getBlobProfile(urlBlob);
        getProfilePromise.then(function (profile) {
            console.log("JSON: ", profile); //This is profile name
        }).catch(function (err) {
            console.error(err);
        });
    });

    return;
}
// End: Subfunctions for Pending blobs
//////////////////////////////////////////////////////////


//////////////////////////////////////////////////////////
// Start: Subfunctions for Transformed blobs
// Blob state is TRANSFORMED
// a. If the are no running importer containers for the blob, retrieve the profile specified in blob metadata: GET /profiles/{id}
// b. Dispatch importer containers according to the profile. The maximum number of containers to dispatch is specified by environment variable IMPORTER_CONCURRENCY
// c. Call POST /blobs/{id} with op=transformationStarted
function processBlobsTransformed(blobs) {
    console.log("Transformed blobs: ", blobs);

    if (noContainers = true) { // If the are no running importer containers for the blob
        _.forEach(blobs, function (urlBlob) {
            var getProfilePromise = getBlobProfile(urlBlob);
            getProfilePromise.then(function (profile) {
                console.log("JSON: ", profile); //This is profile name
            }).catch(function (err) {
                console.error(err);
            });
        });
    }

    return;
}
// End: Subfunctions for Transformed blobs
//////////////////////////////////////////////////////////


//////////////////////////////////////////////////////////
// Start: Subfunctions for Aborted blobs
// Blob state is ABORTED
// a. Terminate any importer containers for the blob
// b. Flush the blobs records from the queue
function processBlobsTransformed(blobs) {
    console.log("Aborted blobs: ", blobs);

    _.forEach(blobs, function (urlBlob) {
        console.log(urlBlob);
    });

    return;
}
// End: Subfunctions for Aborted blobs
//////////////////////////////////////////////////////////


//////////////////////////////////////////////////////////
// Start: Supporting functions
function getBlobProfile(urlBlob) {
    return new Promise(function (resolve, reject) {
        fetch(urlBlob, { headers: { 'Authorization': configCrowd.encodedAuth } })
        .then(res => {
            expect(res.status).to.equal(200);
            return res.json();
        })
        .then(json => {
            expect(json).to.be.not.null;
            expect(json).to.be.an('object');
            expect(json.profile).to.be.not.null;
            expect(json.profile).to.be.an('string');
            resolve(json.profile);
        })
        .catch(err => reject(err));
    })
}
// End: Supporting functions
//////////////////////////////////////////////////////////
