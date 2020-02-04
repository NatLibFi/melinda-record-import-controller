/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* API microservice of Melinda record batch import system
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

export const LABEL_TASK = 'fi.nationallibrary.melinda.record-import.task=true';
export const LABEL_TRANSFORM_TASK = 'fi.nationallibrary.melinda.record-import.container-type=transform-task';
export const LABEL_IMPORT_TASK = 'fi.nationallibrary.melinda.record-import.container-type=import-task';

export const TRANSFORMER_TEMPLATE = {
	Binds: ['/etc/localtime:/etc/localtime:ro'],
	Labels: {
		'fi.nationallibrary.melinda.record-import.task': 'true',
		'fi.nationallibrary.melinda.record-import.container-type': 'transform-task'
	},
	Env: [
		'ABORT_ON_INVALID_RECORDS=false'
	],
	Healthcheck: {
		Test: ['CMD-SHELL', 'node node_modules/@natlibfi/melinda-record-import-commons/dist/health-check.js'],
		Interval: 30000000000,
		Timeout: 10000000000,
		Retries: 3
	}
};

export const IMPORTER_TEMPLATE = {
	Binds: ['/etc/localtime:/etc/localtime:ro'],
	Labels: {
		'fi.nationallibrary.melinda.record-import.task': 'true',
		'fi.nationallibrary.melinda.record-import.container-type': 'import-task'
	},
	Healthcheck: {
		Test: ['CMD-SHELL', 'node node_modules/@natlibfi/melinda-record-import-commons/dist/health-check.js'],
		Interval: 30000000000,
		Timeout: 10000000000,
		Retries: 3
	}
};
