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

import {CommonUtils} from '@natlibfi/melinda-record-import-commons';

let MANDATORY_ENV_VARIABLES = [
	'AMQP_URL',
	'URL_API',
	'MONGODB_URI',
	'WORK_PEND',
	'WORK_TRANS',
	'WORK_ABORT',
	'API_USERNAME',
	'API_PASS'
];

if (process.env.USE_DEF === 'true') {
	MANDATORY_ENV_VARIABLES = [
		'API_USERNAME',
		'API_PASS'
	];
}

CommonUtils.checkEnv(MANDATORY_ENV_VARIABLES); // Check that all values are set

require('./worker')();