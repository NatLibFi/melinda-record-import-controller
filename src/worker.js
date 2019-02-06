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

import {configurationGeneral as config} from '@natlibfi/melinda-record-import-commons';

'use strict';
const Agenda = require('agenda');

const configCtr = require('./config-controller');

const agenda = new Agenda(config.agendaMongo);

const jobTypes = ['dispatch']; // Get jobs from dispatch file from jobs folder

agenda.on('ready', () => {
	jobTypes.forEach(type => {
		require('./jobs/' + type)(agenda);
	});

	agenda.every(configCtr.workerFrequency.pending, config.enums.jobs.pollBlobsPending);

	agenda.every(configCtr.workerFrequency.transformed, config.enums.jobs.pollBlobsTransformed);

	agenda.every(configCtr.workerFrequency.aborted, config.enums.jobs.pollBlobsAborted);

	agenda.start();
});

module.exports = agenda;
