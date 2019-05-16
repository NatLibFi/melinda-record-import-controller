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
import {Utils} from '@natlibfi/melinda-commons';
import {createApiClient} from '@natlibfi/melinda-record-import-commons';
import {logError} from './utils';
import {
	API_URL, API_USERNAME, API_PASSWORD,
	API_CLIENT_USER_AGENT, JOB_UPDATE_IMAGES
} from '../config';

const {createLogger} = Utils;

export default function (agenda) {
	const logger = createLogger();
	const docker = new Docker();
	const ApiClient = createApiClient({
		url: API_URL, username: API_USERNAME, password: API_PASSWORD,
		userAgent: API_CLIENT_USER_AGENT
	});

	agenda.define(JOB_UPDATE_IMAGES, {concurrency: 1}, updateImages);

	async function updateImages(_, done) {
		try {
			const refs = await getImageRefs();
			await Promise.all(refs.map(updateImage));
		} catch (err) {
			logError(err);
		} finally {
			done();
		}

		async function getImageRefs() {
			const results = await ApiClient.queryProfiles();			
			const profiles = await Promise.all(results.map(ApiClient.getProfile));

			return profiles.reduce((acc, profile) => {
				if (!acc.includes(profile.import.image)) {
					acc.push(profile.import.image);
				}

				if (!acc.includes(profile.transformation.image)) {
					acc.push(profile.transformation.image);
				}

				return acc;
			}, []);
		}

		async function updateImage(image) {
			logger.log('debug', `Checking if ${image} has been updated in the registry`);

			const stream = await docker.pull(image);

			return new Promise((resolve, reject) => {
				let pullingImage;
				docker.modem.followProgress(stream, finishCallback, progressCallback);

				function finishCallback(err) {
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				}

				function progressCallback(event) {
					if (/^Status: Image is up to date/.test(event.status)) {
						logger.log('debug', `Image ${image} is up to date`);
					} else if (/^Status: Downloaded newer image/.test(event.status)) {
						logger.log('info', `Completed dowloading new version of ${image}`);
					} else if (/^Pulling fs layer/.test(event.status) && !pullingImage) {
						logger.log('info', `Image ${image} has been updated in the registry. Pulling new version`);
						pullingImage = true;
					}
				}
			});
		}
	}
}
