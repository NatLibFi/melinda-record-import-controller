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
import moment from 'moment';
import HttpStatus from 'http-status';
import humanInterval from 'human-interval';
import {Utils} from '@natlibfi/melinda-commons';
import {BLOB_STATE, createApiClient, ApiError} from '@natlibfi/melinda-record-import-commons';
import {
	API_URL, API_USERNAME, API_PASSWORD, API_CLIENT_USER_AGENT,
	JOB_BLOBS_METADATA_CLEANUP, JOB_BLOBS_CONTENT_CLEANUP,
	BLOBS_METADATA_TTL, BLOBS_CONTENT_TTL

} from '../config';

const {createLogger} = Utils;

export default function (agenda) {
	const Logger = createLogger();
	const docker = new Docker();
	const ApiClient = createApiClient({
		url: API_URL, username: API_USERNAME, password: API_PASSWORD,
		userAgent: API_CLIENT_USER_AGENT
	});

	agenda.define(JOB_BLOBS_METADATA_CLEANUP, blobsMetadataCleanup);
	agenda.define(JOB_BLOBS_CONTENT_CLEANUP, blobsContentCleanup);

	async function blobsMetadataCleanup(_, done) {
		return blobsCleanup({
			method: 'deleteBlob',
			ttl: humanInterval(BLOBS_METADATA_TTL),
			callback: done,
			message: count => `${count} blobs need to be deleted.`
		});
	}

	async function blobsContentCleanup(_, done) {
		return blobsCleanup({
			method: 'deleteBlobContent',
			ttl: humanInterval(BLOBS_CONTENT_TTL),
			callback: done,
			message: count => `${count} blobs need to have their content deleted.`
		});
	}

	async function blobsCleanup({method, message, ttl, callback}) {
		const blobs = await getBlobs();

		if (blobs.length > 0) {
			Logger.log('debug', message(blobs.length));
			await processBlobs();
		}

		callback();

		async function getBlobs() {
			const states = [BLOB_STATE.PROCESSED, BLOB_STATE.ABORTED];
			return filter(await ApiClient.getBlobs({state: states}));

			async function filter(blobs, list = []) {
				const blob = blobs.shift();

				if (blob) {
					const metadata = await ApiClient.getBlobMetadata({id: blob.id});
					const modificationTime = moment(metadata.modificationTime);

					if (modificationTime.add(ttl).isBefore(moment())) {
						return filter(blobs, list.concat(blob.id));
					}

					return filter(blobs, list);
				}

				return list;
			}
		}

		async function processBlobs() {
			return Promise.all(blobs.map(async blob => {
				try {
					await ApiClient[method]({id: blob.id});
					await docker.pruneContainers({
						all: true,
						filters: {
							label: [
								'fi.nationallibrary.melinda.record-import.container-type',
								`blobId=${blob.id}`
							]
						}
					});
				} catch (err) {
					if (err instanceof ApiError && err.status === HttpStatus.NOT_FOUND) {
						Logger.log('debug', `Blob ${blob.id} already removed`);
					// Conflict occurs when prune operation is already running and can be
					} else if (err.status !== HttpStatus.CONFLICT) {
						Logger.log('error', err.stack);
					}
				}
			}));
		}
	}
}
