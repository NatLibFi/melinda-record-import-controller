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
import {JOBS, BLOB_STATE, HTTP_CODES} from '@natlibfi/melinda-record-import-commons';

exports.JOBS = JOBS;
exports.HTTP_CODES = HTTP_CODES;
exports.BLOB_STATE = BLOB_STATE;

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
	aborted: process.env.WORK_ABORT || '10 seconds'
};

exports.IMPORTER_CONCURRENCY = process.env.IMPORTER_CONCURRENCY || 1;

// Logs or no logs
exports.logs = process.env.DEBUG === 'true'; // Default: false

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
		'API_PASSWORD={{API_PASS}}',
		'AMQP_URL={{AMQP_URL}}'
	]
	/*
    Healthcheck: {
        'Test': ['CMD', 'curl -s localhost:8080/healthz'],
        'Interval': 300,
        'Timeout': 10,
        'Retries': '3'
    }
    */
};

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
		'API_PASSWORD={{API_PASS}}',
		'AMQP_URL={{AMQP_URL}}'
	]/* ,
    Healthcheck: {
        'Test': ['CMD', 'curl -s localhost:8080/healthz'],
        'Interval': '30000000000',
        'Timeout': '10000000000',
        'Retries': '3'
    } */
};
