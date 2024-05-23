/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* API microservice of Melinda record batch import system
*
* Copyright (C) 2018-2021 University Of Helsinki (The National Library Of Finland)
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
import {parseBoolean} from '@natlibfi/melinda-commons';

export const TZ = readEnvironmentVariable('TZ', {defaultValue: ''});

export const recordImportApiOptions = {
  recordImportApiUrl: readEnvironmentVariable('RECORD_IMPORT_API_URL', {defaultValue: 'RECORD_IMPORT_API_URL env is not set!'}),
  userAgent: readEnvironmentVariable('API_CLIENT_USER_AGENT', {defaultValue: '_RECORD-IMPORT-IMPORTER'}),
  allowSelfSignedApiCert: readEnvironmentVariable('ALLOW_API_SELF_SIGNED', {defaultValue: false, format: parseBoolean})
};

export const keycloakOptions = {
  issuerBaseURL: readEnvironmentVariable('KEYCLOAK_ISSUER_BASE_URL', {defaultValue: 'KEYCLOAK_ISSUER_BASE_URL env is not set!'}),
  serviceClientID: readEnvironmentVariable('KEYCLOAK_SERVICE_CLIENT_ID', {defaultValue: 'KEYCLOAK_SERVICE_CLIENT_ID env is not set!'}),
  serviceClientSecret: readEnvironmentVariable('KEYCLOAK_SERVICE_CLIENT_SECRET', {defaultValue: 'KEYCLOAK_SERVICE_CLIENT_SECRET env is not set!'})
};

export const MONGO_URI = readEnvironmentVariable('MONGO_URI', {defaultValue: 'mongodb://127.0.0.1/db'});
export const AMQP_URL = readEnvironmentVariable('AMQP_URL', {defaultValue: 'amqp://127.0.0.1:5672'});

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
export const JOB_FREQ_BLOBS_TRANSFORMATION_FAILED_CLEANUP = readEnvironmentVariable('BLOBS_TRANSFORMATION_FAILED_CLEANUP', {defaultValue: '10 seconds'});
export const JOB_FREQ_BLOBS_TRANSFORMATION_FAILED_CONTENT_CLEANUP = readEnvironmentVariable('BLOBS_TRANSFORMATION_FAILED_CONTENT_CLEANUP', {defaultValue: '10 seconds'});

export const JOB_FREQ_UPDATE_IMAGES = readEnvironmentVariable('JOB_FREQ_UPDATE_IMAGES', {defaultValue: '10 seconds'});

export const IMPORT_OFFLINE_PERIOD = readEnvironmentVariable('IMPORT_OFFLINE_PERIOD', {defaultValue: {}, format: JSON.parse});

// Default is 5 minutes
export const STALE_TRANSFORMATION_PROGRESS_TTL = readEnvironmentVariable('STALE_TRANSFORMATION_PROGRESS_TTL', {defaultValue: '15 minutes'});
export const STALE_PROCESSING_PROGRESS_TTL = readEnvironmentVariable('STALE_PROCESSING_PROGRESS_TTL', {defaultValue: '2 hours'});
export const TRANSFORMATION_FAILED_TTL = readEnvironmentVariable('TRANSFORMATION_FAILED_TTL', {defaultValue: '12 hours'});
export const TRANSFORMATION_FAILED_CONTENT_TTL = readEnvironmentVariable('TRANSFORMATION_FAILED_CONTENT_TTL', {defaultValue: '10 hours'});

export const MAX_BLOB_IMPORT_TRIES = readEnvironmentVariable('MAX_BLOB_IMPORT_TRIES', {defaultValue: 5, format: v => Number(v)});

export const API_CLIENT_USER_AGENT = readEnvironmentVariable('API_CLIENT_USER_AGENT', {defaultValue: '_RECORD-IMPORT-CONTROLLER'});

export const PROCESS_START_TIME = moment();

export const JOB_BLOBS_PENDING = 'BLOBS_PENDING';
export const JOB_BLOBS_PROCESSING = 'BLOBS_PROCESSING';
export const JOB_BLOBS_TRANSFORMED = 'BLOBS_TRANSFORMED';
export const JOB_BLOBS_ABORTED = 'BLOBS_ABORTED';

export const JOB_BLOBS_CONTENT_CLEANUP = 'BLOBS_CONTENT_CLEANUP';
export const JOB_BLOBS_METADATA_CLEANUP = 'BLOBS_METADATA_CLEANUP';
export const JOB_BLOBS_MISSING_RECORDS = 'BLOBS_MISSING_RECORDS';
export const JOB_BLOBS_TRANSFORMATION_QUEUE_CLEANUP = 'BLOBS_TRANSFORMATION_QUEUE_CLEANUP';
export const JOB_BLOBS_TRANSFORMATION_FAILED_CLEANUP = 'BLOBS_TRANSFORMATION_FAILED_CLEANUP';
export const JOB_BLOBS_TRANSFORMATION_FAILED_CONTENT_CLEANUP = 'BLOBS_TRANSFORMATION_FAILED_CONTENT_CLEANUP';
export const JOB_BLOBS_PROCESSING_QUEUE_CLEANUP = 'BLOBS_PROCESSING_QUEUE_CLEANUP';
