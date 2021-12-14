/**

*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* Controller microservice of Melinda record batch import system
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

import {createLogger} from '@natlibfi/melinda-backend-commons';
import moment from 'moment';

export function logError(err) {
  const logger = createLogger();
  logger.error('stack' in err ? err.stack : err);
}

export function processBlobs({client, query, processCallback, messageCallback, filter = () => true}) {
  return new Promise((resolve, reject) => {
    let blobsTotal = 0; // eslint-disable-line functional/no-let

    const logger = createLogger();
    const pendingProcessors = [];
    const emitter = client.getBlobs(query);

    emitter
      .on('error', reject)
      .on('blobs', blobs => {
        const filteredBlobs = blobs.filter(filter);

        blobsTotal += filteredBlobs.length;
        pendingProcessors.push(processCallback(filteredBlobs)); // eslint-disable-line functional/immutable-data
      })
      .on('end', () => {
        if (messageCallback) { // eslint-disable-line functional/no-conditional-statement
          logger.debug(messageCallback(blobsTotal));
        }

        resolve(Promise.all(pendingProcessors));
      });
  });
}

export function isOfflinePeriod(IMPORT_OFFLINE_PERIOD, addedHours = 0) {
  const {startHour, lengthHours} = IMPORT_OFFLINE_PERIOD;
  const now = moment();

  if (startHour !== undefined && lengthHours !== undefined) {
    if (now.hour() < startHour) {
      const start = moment(now).hour(startHour).subtract(1, 'days');
      return check(start);
    }

    const start = moment(now).hour(startHour);
    return check(start);
  }

  function check(startTime) {
    const endTime = moment(startTime).add(lengthHours + addedHours, 'hours');
    return now >= startTime && now < endTime;
  }
}
