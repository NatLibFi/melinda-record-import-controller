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
import * as commons from '@natlibfi/melinda-record-import-commons';

exports.enums = {
	ENVIRONMENT: commons.ENVIRONMENT, // Not used
	BLOB_STATE: commons.BLOB_STATE,
	RECORD_IMPORT_STATE: commons.RECORD_IMPORT_STATE, // Not used
	HTTP_CODES: commons.HTTP_CODES,
	ERROR_TYPES: commons.ERROR_TYPES, // Not used
	JOBS: commons.JOBS
};

// "Mandatory" environment variables
exports.AMQP_URL = process.env.AMQP_URL || 'amqp://host:port';

exports.urlAPI = process.env.URL_API || 'http://127.0.0.1:3000';

exports.portController = process.env.PORT_CNTRL || 3001;

exports.agendaMongo = {
	db: {
		address: process.env.MONGODB_URI || 'mongodb://generalAdmin:ToDoChangeAdmin@127.0.0.1:27017/melinda-record-import-api',
		collection: 'jobs'
	}
};

exports.workerFrequency = {
	pending: process.env.WORK_PEND || '10 seconds',
	transformed: process.env.WORK_TRANS || '10 seconds',
	aborted: process.env.WORK_ABORT || '10 seconds',
	health: process.env.HEALTH || '10 seconds'
};

exports.IMPORTER_CONCURRENCY = process.env.IMPORTER_CONCURRENCY || 1;
exports.CONTAINERS_CONCURRENCY = process.env.CONTAINERS_CONCURRENCY || 10;

// Base configurations for dockering, {} values are replaced on dispatching
exports.transformer = {
	Image: '{profile.transformation.image}',
	AttachStdout: true, // Used to read logs
	Labels: {
		'fi.nationallibrary.melinda.record-import.container-type': 'transform-task',
		blobID: null
	},
	Env: [
		'ABORT_ON_INVALID_RECORDS={profile.transformation.abortOnInvalidRecords}',
		'PROFILE_ID={profile.name}',
		'BLOB_ID={profile.blob=blob.id}*',
		'API_URL={{URL_API}}',
		'API_USERNAME={{API_USERNAME}}',
		'API_PASSWORD={{API_PASSWORD}}',
		'AMQP_URL={{AMQP_URL}}'
	],
	Healthcheck: {
		Test: ['CMD-SHELL', 'node node_modules/.bin/healthz'],
		Interval: 30000000000,
		Timeout: 10000000000,
		Retries: 3
	}
};

// Alternative way to do healthchecking:
// Test: ['CMD-SHELL', 'node dist/health-check.js'],
// https://blog.sixeyed.com/docker-healthchecks-why-not-to-use-curl-or-iwr/

exports.importer = {
	Image: '{profile.import.image}',
	AttachStdout: true, // Used to read logs
	Labels: {
		'fi.nationallibrary.melinda.record-import.container-type': 'import-task',
		blobID: null
	},
	Env: [
		'PROFILE_ID={profile.name}',
		'BLOB_ID={profile.blob=blob.id}',
		'API_URL={{URL_API}}',
		'API_USERNAME={{API_USERNAME}}',
		'API_PASSWORD={{API_PASSWORD}}',
		'AMQP_URL={{AMQP_URL}}'
	],
	Healthcheck: {
		Test: ['CMD-SHELL', 'node node_modules/.bin/healthz'],
		Interval: 30000000000,
		Timeout: 10000000000,
		Retries: 3
	}
};
