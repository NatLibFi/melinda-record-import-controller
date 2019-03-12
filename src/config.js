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

import {Utils} from '@natlibfi/melinda-commons';

const {readEnvironmentVariable} = Utils;

export const API_URL = readEnvironmentVariable('API_URL');
export const API_USERNAME = readEnvironmentVariable('API_USERNAME');
export const API_PASSWORD = readEnvironmentVariable('API_PASSWORD');

export const MONGODB_URI = readEnvironmentVariable('MONGODB_URI', {defaultValue: 'mongodb://127.0.0.1/db'});
export const AMQP_URL = readEnvironmentVariable('MONGODB_URI', {defaultValue: 'amqp://127.0.0.1:5672'});

export const IMPORTER_CONCURRENCY = readEnvironmentVariable('IMPORTER_CONCURRENCY', {defaultValue: 1, format: v => Number(v)});
export const CONTAINERS_CONCURRENCY = readEnvironmentVariable('CONTAINERS_CONCURRENCY', {defaultValue: 5, format: v => Number(v)});

export const JOB_FREQ_BLOBS_PENDING = readEnvironmentVariable('JOB_FREQ_BLOBS_PENDING', {defaultValue: '10 seconds'});
export const JOB_FREQ_BLOBS_TRANSFORMED = readEnvironmentVariable('JOB_FREQ_BLOBS_TRANSFORMED', {defaultValue: '10 seconds'});
export const JOB_FREQ_BLOBS_ABORTED = readEnvironmentVariable('JOB_FREQ_BLOBS_ABORTED', {defaultValue: '10 seconds'});
export const JOB_FREQ_CONTAINERS_HEALTH = readEnvironmentVariable('JOB_FREQ_CONTAINERS_HEALTH', {defaultValue: '10 seconds'});

// Export const JOB_FREQ_BLOBS_CONTENT_CLEANUP = readEnvironmentVariable('JOB_FREQ_BLOBS_CONTENT_CLEANUP', {defaultValue: '30 minutes'});
// export const JOB_FREQ_BLOBS_METADATA_CLEANUP = readEnvironmentVariable('JOB_FREQ_BLOBS_METADATA_CLEANUP', {defaultValue: '30 minutes'});

export const JOB_BLOBS_PENDING = 'BLOBS_PENDING';
export const JOB_BLOBS_TRANSFORMED = 'BLOBS_TRANSFORMED';
export const JOB_BLOBS_ABORTED = 'BLOBS_ABORTED';
export const JOB_CONTAINERS_HEALTH = 'CONTAINERS_HEALTH';

// Export const JOB_BLOBS_CONTENT_CLEANUP = '';
// export const JOB_BLOBS_METADATA_CLEANUP = '';

export const CONTAINER_TEMPLATE_TRANSFORMER = {
	Labels: {
		'fi.nationallibrary.melinda.record-import.task': 'true',
		'fi.nationallibrary.melinda.record-import.container-type': 'transform-task'
	},
	Env: [
		`AMQP_URL=${AMQP_URL}`,
		`API_URL=${API_URL}`,
		`API_USERNAME=${API_USERNAME}`,
		`API_PASSWORD=${API_PASSWORD}`,
		'ABORT_ON_INVALID_RECORDS=true'
	],
	Healthcheck: {
		Test: ['CMD-SHELL', 'node node_modules/.bin/healthz'],
		Interval: 30000000000,
		Timeout: 10000000000,
		Retries: 3
	}
};

export const CONTAINER_TEMPLATE_IMPORTER = {
	Labels: {
		'fi.nationallibrary.melinda.record-import.task': 'true',
		'fi.nationallibrary.melinda.record-import.container-type': 'import-task'
	},
	Env: [
		`AMQP_URL=${AMQP_URL}`,
		`API_URL=${API_URL}`,
		`API_USERNAME=${API_USERNAME}`,
		`API_PASSWORD=${API_PASSWORD}`
	],
	Healthcheck: {
		Test: ['CMD-SHELL', 'node node_modules/.bin/healthz'],
		Interval: 30000000000,
		Timeout: 10000000000,
		Retries: 3
	}
};
