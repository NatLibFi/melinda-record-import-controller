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
export const AMQP_URL = readEnvironmentVariable('AMQP_URL', {defaultValue: 'amqp://127.0.0.1:5672'});

export const QUEUE_MAX_MESSAGE_TRIES = readEnvironmentVariable('QUEUE_MAX_MESSAGE_TRIES', {defaultValue: 3, format: v => Number(v)});
export const QUEUE_MESSAGE_WAIT_TIME = readEnvironmentVariable('QUEUE_MESSAGE_WAIT_TIME', {defaultValue: 3000, format: v => Number(v)});

export const IMPORTER_CONCURRENCY = readEnvironmentVariable('IMPORTER_CONCURRENCY', {defaultValue: 1, format: v => Number(v)});
export const CONTAINER_CONCURRENCY = readEnvironmentVariable('CONTAINER_CONCURRENCY', {defaultValue: 5, format: v => Number(v)});

export const CONTAINER_NETWORK = readEnvironmentVariable('CONTAINER_NETWORK', {defaultValue: [], format: v => JSON.parse(v)});

export const BLOBS_METADATA_TTL = readEnvironmentVariable('BLOB_METADATA_TTL');
export const BLOBS_CONTENT_TTL = readEnvironmentVariable('BLOB_CONTENT_TTL');

export const JOB_FREQ_BLOBS_PENDING = readEnvironmentVariable('JOB_FREQ_BLOBS_PENDING', {defaultValue: '10 seconds'});
export const JOB_FREQ_BLOBS_TRANSFORMED = readEnvironmentVariable('JOB_FREQ_BLOBS_TRANSFORMED', {defaultValue: '10 seconds'});
export const JOB_FREQ_BLOBS_ABORTED = readEnvironmentVariable('JOB_FREQ_BLOBS_ABORTED', {defaultValue: '10 seconds'});
export const JOB_FREQ_CONTAINERS_HEALTH = readEnvironmentVariable('JOB_FREQ_CONTAINERS_HEALTH', {defaultValue: '10 seconds'});

export const JOB_FREQ_BLOBS_CONTENT_CLEANUP = readEnvironmentVariable('JOB_FREQ_BLOBS_CONTENT_CLEANUP', {defaultValue: '10 seconds'});
export const JOB_FREQ_BLOBS_METADATA_CLEANUP = readEnvironmentVariable('JOB_FREQ_BLOBS_METADATA_CLEANUP', {defaultValue: '10 seconds'});

export const JOB_BLOBS_PENDING = 'BLOBS_PENDING';
export const JOB_BLOBS_TRANSFORMED = 'BLOBS_TRANSFORMED';
export const JOB_BLOBS_ABORTED = 'BLOBS_ABORTED';
export const JOB_CONTAINERS_HEALTH = 'CONTAINERS_HEALTH';

export const JOB_BLOBS_CONTENT_CLEANUP = 'BLOBS_CONTENT_CLEANUP';
export const JOB_BLOBS_METADATA_CLEANUP = 'BLOBS_METADATA_CLEANUP';

export const API_CLIENT_USER_AGENT = readEnvironmentVariable('API_CLIENT_USER_AGENT', {defaultValue: '_RECORD-IMPORT-CONTROLLER'});

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
		'ABORT_ON_INVALID_RECORDS=false',
		`DEBUG=${process.env.DEBUG}`
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
		`API_PASSWORD=${API_PASSWORD}`,
		`DEBUG=${process.env.DEBUG}`
	],
	Healthcheck: {
		Test: ['CMD-SHELL', 'node node_modules/.bin/healthz'],
		Interval: 30000000000,
		Timeout: 10000000000,
		Retries: 3
	}
};
