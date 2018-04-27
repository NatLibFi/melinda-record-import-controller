/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file. 
*
* API microservice of Melinda record batch import system
*
* Copyright (C) 2018 University Of Helsinki (The National Library Of Finland)
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

/* eslint-disable no-unused-vars */

'use strict';
var enums = require('../melinda-record-import-commons/utils/enums');

exports.hostname = process.env.hostname || 'localhost';
exports.environment = enums.environment.development;
exports.port = process.env.PORT || 3001;

exports.mongodb = {
    uri: process.env.MONGODB_URI || process.env.MONGOLAB_URI || process.env.MONGOHQ_URL || 'mongodb://generalAdmin:ToDoChangeAdmin@127.0.0.1:27017/melinda-record-import-api'
};

exports.agendaMongo = {
    db: {
        address: 'mongodb://generalAdmin:ToDoChangeAdmin@127.0.0.1:27017/melinda-record-import-api',
        collection: 'jobs'
    }
};

exports.mongoDebug = false;

exports.logs = false;