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

import moment from 'moment';
import {readEnvironmentVariable} from '@natlibfi/melinda-backend-commons';

export const TZ = readEnvironmentVariable('TZ', {defaultValue: ''});

export const API_URL = readEnvironmentVariable('API_URL');
export const API_USERNAME = readEnvironmentVariable('API_USERNAME');
export const API_PASSWORD = readEnvironmentVariable('API_PASSWORD');
export const API_USERNAME_IMPORTER = readEnvironmentVariable('API_USERNAME_IMPORTER');
export const API_PASSWORD_IMPORTER = readEnvironmentVariable('API_PASSWORD_IMPORTER');
export const API_USERNAME_TRANSFORMER = readEnvironmentVariable('API_USERNAME_TRANSFORMER');
export const API_PASSWORD_TRANSFORMER = readEnvironmentVariable('API_PASSWORD_TRANSFORMER');

export const MONGO_URI = readEnvironmentVariable('MONGO_URI', {defaultValue: 'mongodb://127.0.0.1/db'});
export const AMQP_URL = readEnvironmentVariable('AMQP_URL', {defaultValue: 'amqp://127.0.0.1:5672'});

export const IMPORTER_CONCURRENCY = readEnvironmentVariable('IMPORTER_CONCURRENCY', {defaultValue: 1, format: v => Number(v)});
export const CONTAINER_CONCURRENCY = readEnvironmentVariable('CONTAINER_CONCURRENCY', {defaultValue: 5, format: v => Number(v)});

export const CONTAINER_NETWORKS = readEnvironmentVariable('CONTAINER_NETWORKS', {defaultValue: [], format: v => JSON.parse(v)});

export const BLOBS_METADATA_TTL = readEnvironmentVariable('BLOB_METADATA_TTL');
export const BLOBS_CONTENT_TTL = readEnvironmentVariable('BLOB_CONTENT_TTL');

export const JOB_FREQ_BLOBS_PENDING = readEnvironmentVariable('JOB_FREQ_BLOBS_PENDING', {defaultValue: '10 seconds'});
export const JOB_FREQ_BLOBS_PROCESSING = readEnvironmentVariable('JOB_FREQ_BLOBS_PROCESSING', {defaultValue: '10 seconds'});
export const JOB_FREQ_BLOBS_TRANSFORMED = readEnvironmentVariable('JOB_FREQ_BLOBS_TRANSFORMED', {defaultValue: '10 seconds'});
export const JOB_FREQ_BLOBS_ABORTED = readEnvironmentVariable('JOB_FREQ_BLOBS_ABORTED', {defaultValue: '10 seconds'});

export const JOB_FREQ_BLOBS_CONTENT_CLEANUP = readEnvironmentVariable('JOB_FREQ_BLOBS_CONTENT_CLEANUP', {defaultValue: '10 seconds'});
export const JOB_FREQ_BLOBS_METADATA_CLEANUP = readEnvironmentVariable('JOB_FREQ_BLOBS_METADATA_CLEANUP', {defaultValue: '10 seconds'});
export const JOB_FREQ_BLOBS_MISSING_RECORDS = readEnvironmentVariable('JOB_FREQ_BLOBS_MISSING_RECORDS', {defaultValue: '10 seconds'});
export const JOB_FREQ_BLOBS_TRANSFORMATION_QUEUE_CLEANUP = readEnvironmentVariable('JOB_FREQ_BLOBS_BLOBS_TRANSFORMATION_QUEUE_CLEANUP', {defaultValue: '10 seconds'});
export const JOB_FREQ_BLOBS_PROCESSING_QUEUE_CLEANUP = readEnvironmentVariable('JOB_FREQ_BLOBS_PROCESSING_QUEUE_CLEANUP', {defaultValue: '10 seconds'});

export const JOB_FREQ_CONTAINERS_HEALTH = readEnvironmentVariable('JOB_FREQ_CONTAINERS_HEALTH', {defaultValue: '10 seconds'});
export const JOB_FREQ_PRUNE_CONTAINERS = readEnvironmentVariable('JOB_FREQ_PRUNE_CONTAINERS', {defaultValue: '10 seconds'});
export const JOB_FREQ_UPDATE_IMAGES = readEnvironmentVariable('JOB_FREQ_UPDATE_IMAGES', {defaultValue: '10 seconds'});

export const IMPORT_OFFLINE_PERIOD = readEnvironmentVariable('IMPORT_OFFLINE_PERIOD', {defaultValue: {}, format: JSON.parse});

// Default is 5 minutes
export const STALE_TRANSFORMATION_PROGRESS_TTL = readEnvironmentVariable('STALE_TRANSFORMATION_PROGRESS_TTL', {defaultValue: '5 minutes'});
export const STALE_PROCESSING_PROGRESS_TTL = readEnvironmentVariable('STALE_PROCESSING_PROGRESS_TTL', {defaultValue: '20 minutes'});

export const MAX_BLOB_IMPORT_TRIES = readEnvironmentVariable('MAX_BLOB_IMPORT_TRIES', {defaultValue: 5, format: v => Number(v)});

export const API_CLIENT_USER_AGENT = readEnvironmentVariable('API_CLIENT_USER_AGENT', {defaultValue: '_RECORD-IMPORT-CONTROLLER'});

export const SUPPORTED_DOCKER_API_VERSIONS = readEnvironmentVariable('SUPPORTED_DOCKER_API_VERSIONS', {defaultValue: ['1.39', '1.40'], format: v => JSON.parse(v)});

export const PROCESS_START_TIME = moment();

export const JOB_BLOBS_PENDING = 'BLOBS_PENDING';
export const JOB_BLOBS_PROSESSING = 'BLOBS_PROCESSING';
export const JOB_BLOBS_TRANSFORMED = 'BLOBS_TRANSFORMED';
export const JOB_BLOBS_ABORTED = 'BLOBS_ABORTED';

export const JOB_BLOBS_CONTENT_CLEANUP = 'BLOBS_CONTENT_CLEANUP';
export const JOB_BLOBS_METADATA_CLEANUP = 'BLOBS_METADATA_CLEANUP';
export const JOB_BLOBS_MISSING_RECORDS = 'BLOBS_MISSING_RECORDS';
export const JOB_BLOBS_TRANSFORMATION_QUEUE_CLEANUP = 'BLOBS_TRANSFORMATION_QUEUE_CLEANUP';
export const JOB_BLOBS_PROCESSING_QUEUE_CLEANUP = 'BLOBS_PROCESSING_QUEUE_CLEANUP';
export const JOB_CONTAINERS_HEALTH = 'CONTAINERS_HEALTH';
export const JOB_PRUNE_CONTAINERS = 'PRUNE_CONTAINERS';
export const JOB_UPDATE_IMAGES = 'UPDATE_IMAGES';

export const CONTAINER_TEMPLATE_TRANSFORMER = {
	name: 'record-import-transformer-',
	Binds: ['/etc/localtime:/etc/localtime:ro'],
	Labels: {
		'fi.nationallibrary.melinda.record-import.task': 'true',
		'fi.nationallibrary.melinda.record-import.container-type': 'transform-task'
	},
	Env: [
		`AMQP_URL=${AMQP_URL}`,
		`API_URL=${API_URL}`,
		`API_USERNAME=${API_USERNAME_TRANSFORMER}`,
		`API_PASSWORD=${API_PASSWORD_TRANSFORMER}`,
		'ABORT_ON_INVALID_RECORDS=false',
		`LOG_LEVEL=${process.env.LOG_LEVEL}`
	],
	Healthcheck: {
		Test: ['CMD-SHELL', 'node node_modules/@natlibfi/melinda-record-import-commons/dist/health-check.js'],
		Interval: 30000000000,
		Timeout: 10000000000,
		Retries: 3
	}
};

export const CONTAINER_TEMPLATE_IMPORTER = {
	name: 'record-import-importer-',
	Binds: ['/etc/localtime:/etc/localtime:ro'],
	Labels: {
		'fi.nationallibrary.melinda.record-import.task': 'true',
		'fi.nationallibrary.melinda.record-import.container-type': 'import-task'
	},
	Env: [
		`AMQP_URL=${AMQP_URL}`,
		`API_URL=${API_URL}`,
		`API_USERNAME=${API_USERNAME_IMPORTER}`,
		`API_PASSWORD=${API_PASSWORD_IMPORTER}`,
		`LOG_LEVEL=${process.env.LOG_LEVEL}`
	],
	Healthcheck: {
		Test: ['CMD-SHELL', 'node node_modules/@natlibfi/melinda-record-import-commons/dist/health-check.js'],
		Interval: 30000000000,
		Timeout: 10000000000,
		Retries: 3
	}
};
