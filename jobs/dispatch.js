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
var fetch = require('node-fetch');

var enums = require('../../melinda-record-import-commons/utils/enums'),
    config = require('../../melinda-record-import-commons/config'),
    configCrowd = require('../../melinda-record-import-commons/configCrowd');

var encodedAuth = configCrowd.encodedAuth;

var url = 'http://' + config.hostname + ':' + config.portAPI + '/blobs';

module.exports = function (agenda) {
    agenda.define(enums.jobs.pollBlobs, function (job, done) {        
        fetch(url, { headers: { 'Authorization': encodedAuth } })
        .then(res => res.json())
        .then(json => console.log(json))
        .then(done());

    });

    agenda.define('reset password', function (job, done) {
        console.log("Job: res pass");
        done();
    })
}