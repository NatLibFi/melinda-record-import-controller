/**

*
* @licstart  The following is the entire license notice for the JavaScript code in this file. 
*
* Controller microservice of Melinda record batch import system
*
* Copyright (C) 2018 University Of Helsinki (The National Library Of Finland)
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

/* eslint-disable no-unused-vars */

'use strict';
exports.DOCKER_API = 'https://docs.docker.com/engine/api/v1.25/#operation/';

exports.transformer = {
    Image: '{profile.transformation.image}',
    AttachStdout: true, //Used to read logs
    Labels: {
        'fi.nationallibrary.melinda.record-import.container-type': 'transform-task',
        'blobID': null
    },
    /*
    ExposedPorts: {
        '3002/tcp': {},
    },
    PortBindings: {
        '3002/tcp': [{
            'HostIP': '0.0.0.0',
            'HostPort': '3002'
        }]
    },*/
    Env: [
      'ABORT_ON_INVALID_RECORDS={profile.transformation.abortOnInvalidRecords}',
      'PROFILE_ID={profile-id}',
      'BLOB_ID={blob-id}*',
      'API_URL={{API_URL}}',
      'API_USERNAME={TRANSFORMER_API_USERNAME}',
      'API_PASSWORD={TRANSFORMER_API_PASSWORD}',
      'AMQP_URL={{AMQP_URL}}'
    ],
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
    AttachStdout: true, //Used to read logs
    Labels: {
        'fi.nationallibrary.melinda.record-import.container-type': 'import-task',
        'blobID': null
    },
    Env: [
      'PROFILE_ID={profile-id}',
      'BLOB_ID={blob-id}',
      'API_URL={{API_URL}}',
      'API_USERNAME={TRANSFORMER_API_USERNAME}',
      'API_PASSWORD={TRANSFORMER_API_PASSWORD}',
      'AMQP_URL={{AMQP_URL}}'
    ]/*,
    Healthcheck: {
        'Test': ['CMD', 'curl -s localhost:8080/healthz'],
        'Interval': '30000000000',
        'Timeout': '10000000000',
        'Retries': '3'
    }*/
}