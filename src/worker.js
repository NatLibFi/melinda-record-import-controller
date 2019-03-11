/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* API microservice of Melinda record batch import system
*
* Copyright (C) 2018-2019 University Of Helsinki (The National Library Of Finland)
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

'use strict';

const {Utils} = require('@natlibfi/melinda-commons');

const Agenda = require('agenda');

const config = require('./config-controller');

const agenda = new Agenda(config.agendaMongo);

const jobTypes = ['dispatch']; // Get jobs from dispatch file from jobs folder

const {createLogger} = Utils;

module.exports = function () {
	const Logger = createLogger();

	Logger.log('info', 'Starting melinda-record-import-controller');

	agenda.on('ready', () => {
		jobTypes.forEach(type => {
			require('./jobs/' + type)(agenda);
		});

		agenda.every(config.workerFrequency.pending, config.enums.JOBS.pollBlobsPending);

		agenda.every(config.workerFrequency.transformed, config.enums.JOBS.pollBlobsTransformed);

		agenda.every(config.workerFrequency.aborted, config.enums.JOBS.pollBlobsAborted);

		agenda.every(config.workerFrequency.health, config.enums.JOBS.checkContainerHealth);

		agenda.start();
	});
};
