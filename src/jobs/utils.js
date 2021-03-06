/**

*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* Controller microservice of Melinda record batch import system
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

import Docker from 'dockerode';
import {createLogger} from '@natlibfi/melinda-backend-commons';

export async function stopContainers(filters) {
	const logger = createLogger();
	const docker = new Docker();
	const containersInfo = await docker.listContainers({filters});

	if (containersInfo.length > 0) {
		await Promise.all(containersInfo.map(async info => {
			try {
				const cont = await docker.getContainer(info.Id);

				if (info.State === 'running') {
					logger.log('debug', 'Stopping container');
					await cont.stop();
				}
			} catch (err) {
				logError(err);
			}
		}));
	}
}

export function logError(err) {
	const logger = createLogger();
	logger.log('error', 'stack' in err ? err.stack : err);
}

export async function processBlobs({client, query, processCallback, messageCallback, filter = () => true}) {
	return new Promise((resolve, reject) => {
		let blobsTotal = 0;

		const logger = createLogger();
		const pendingProcessors = [];
		const emitter = client.getBlobs(query);

		emitter
			.on('error', reject)
			.on('blobs', blobs => {
				const filteredBlobs = blobs.filter(filter);
				blobsTotal += filteredBlobs.length;
				pendingProcessors.push(processCallback(filteredBlobs, pendingProcessors.length !== 0));
			})
			.on('end', () => {
				if (messageCallback) {
					logger.log('debug', messageCallback(blobsTotal));
				}

				resolve(Promise.all(pendingProcessors));
			});
	});
}
