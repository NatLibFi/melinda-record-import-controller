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

import {createApiClient} from '@natlibfi/melinda-record-import-commons';
import {logError} from '../utils';

export default function (agenda, {
	updateImages,
	API_URL, API_USERNAME, API_PASSWORD, API_CLIENT_USER_AGENT, JOB_UPDATE_IMAGES
}) {
	const client = createApiClient({
		url: API_URL, username: API_USERNAME, password: API_PASSWORD,
		userAgent: API_CLIENT_USER_AGENT
	});

	agenda.define(JOB_UPDATE_IMAGES, {}, updateImagesJob);

	async function updateImagesJob(_, done) {
		try {
			const refs = await getImageRefs();
			await updateImages(refs);
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
	}
}
