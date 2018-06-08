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

import {configurationGeneral as config} from '@natlibfi/melinda-record-import-commons';

var express = require('express'),
    bodyParser = require('body-parser'),
    cors = require('cors'),
    mongoose = require('mongoose');

const MANDATORY_ENV_VARIABLES = [
    'AMQP_URL',
    'URL_API',
    'PORT_CNTRL',
    'MONGODB_URI',
    'WORK_PEND',
    'WORK_TRANS',
    'WORK_ABORT',
    'IMPORTER_CONCURRENCY',
    'CROWD_USERNAME',
    'CROWD_PASS'
];

//If USE_DEF is set to true, app uses default values
if(!process.env.USE_DEF){
    config.default(MANDATORY_ENV_VARIABLES);
}else{
    var configCrowd = require('./config-crowd')
    if(configCrowd){
        process.env.CROWD_USERNAME = configCrowd.username;
        process.env.CROWD_PASS = configCrowd.password;
    }else{
        throw new Error('Trying to use default variables, but Crowd configuration file not found');
    }
}

var app = express();
app.config = config;
app.enums = config.enums;
app.use(cors());

// Normal express config defaults
app.use(require('morgan')('dev'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

require('./worker');

//mongoose.connect(app.config.mongodb.uri);

// finally, let's start our server...
var server = app.listen(app.config.portController, function () {
    console.log('Server running at addres: ', server.address(), ' using API: ' , app.config.urlAPI);
});