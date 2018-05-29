/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file. 
*
* API microservice of Melinda record batch import system
*
* Copyright (C) 2018 University Of Helsinki (The National Library Of Finland)
*
* This file is part of melinda-record-import-api
*
* melinda-record-import-api program is free software: you can redistribute it and/or modify
* it under the terms of the GNU Affero General Public License as
* published by the Free Software Foundation, either version 3 of the
* License, or (at your option) any later version.
*
* melinda-record-import-api is distributed in the hope that it will be useful,
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
var Agenda = require('agenda');

var configCtr = require('./config'),
    enums = require('../melinda-record-import-commons/utils/enums');

var agenda = new Agenda(config.agendaMongo);

//var jobTypes = process.env.JOB_TYPES ? process.env.JOB_TYPES.split(',') : [];
var jobTypes = ['dispatch']; //Get jobs from dispatch file from jobs folder

agenda.on('ready', () => {
    agenda.cancel({ name: enums.jobs.pollBlobsPending }, function (err, numRemoved) {
        console.log("Removed jobs: ", numRemoved, " errors: ", err);
        jobTypes.forEach(function (type) {
            require('./jobs/' + type)(agenda);
        })
        agenda.every(configCtr.workerFreaquency.pending, enums.jobs.pollBlobsPending);

        agenda.every(configCtr.workerFreaquency.transformed, enums.jobs.pollBlobsTransformed);

        agenda.every(configCtr.workerFreaquency.aborted, enums.jobs.pollBlobsAborted);

        agenda.start();
    });
});

module.exports = agenda;