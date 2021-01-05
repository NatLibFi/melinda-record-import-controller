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
import {createApiClient} from '@natlibfi/melinda-record-import-commons';
import {logError} from './utils';
import {
	API_URL, API_USERNAME, API_PASSWORD,
	API_CLIENT_USER_AGENT, JOB_UPDATE_IMAGES
} from '../config';

export default function (agenda) {
	const logger = createLogger();
	const client = createApiClient({
		url: API_URL, username: API_USERNAME, password: API_PASSWORD,
		userAgent: API_CLIENT_USER_AGENT
	});

	agenda.define(JOB_UPDATE_IMAGES, {concurrency: 1}, updateImages);

	async function updateImages(_, done) {
		const docker = new Docker();

		try {
			const refs = await getImageRefs();
			const images404 = [];

			logger.log('debug', `Checking updates for ${refs.length} images  in the registry`);

			await Promise.all(refs.map(async ref => {
				try {
					const image = docker.getImage(ref);
					const {RepoDigests} = await image.inspect();
					if (RepoDigests && RepoDigests.length > 0) {
						await updateImage(ref);
					}
				} catch (err) {
					if (err.statusCode === 404) {
						if (images404.includes(ref) === false) {
							logger.log('debug', `Did not found image ${ref} locally, trying to pull it from remote`);
							await updateImage(ref);
							images404.push(ref);
						} else {
							logError(err);
							process.exit(1);
						}
					}
				}
			}));
			logger.log('debug', 'Done checking updates for images in the registry');
		} catch (err) {
			logError(err);
		} finally {
			done();
		}

		async function getImageRefs() {
			const results = await client.queryProfiles();
			const profiles = await Promise.all(results.map(client.getProfile));

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
					if (/^Status: Downloaded newer image/.test(event.status)) {
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
