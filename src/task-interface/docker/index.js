/**
*
* @licstart  The following is the entire license notice for the JavaScript code in this file.
*
* API microservice of Melinda record batch import system
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

import Docker from 'dockerode';
import HttpStatus from 'http-status';
import {clone} from '@natlibfi/melinda-commons';
import {createLogger} from '@natlibfi/melinda-backend-commons';
import {logError} from '../../utils';
import {TRANSFORMER_TEMPLATE, IMPORTER_TEMPLATE, LABEL_IMPORT_TASK, LABEL_TASK, LABEL_TRANSFORM_TASK} from './constants';

export default async ({
  DOCKER_SUPPORTED_API_VERSIONS, DOCKER_CONTAINER_NETWORKS,
  AMQP_URL, API_URL, DEBUG,
  API_USERNAME_TRANSFORMER, API_PASSWORD_TRANSFORMER,
  API_USERNAME_IMPORTER, API_PASSWORD_IMPORTER
}) => {
  const logger = createLogger();
  const docker = new Docker();

  if (await isSupportedDockerVersion()) {
    return {pruneTasks, updateImages, dispatchTask, listTasks, terminateTasks};
  }

  throw new Error('Docker API version is not supported');

  async function isSupportedDockerVersion() {
    const {ApiVersion} = await docker.version();
    return DOCKER_SUPPORTED_API_VERSIONS.includes(ApiVersion);
  }

  async function dispatchTask({type, blob, profile, options}) {
    const manifest = {
      Image: options.image,
      ...clone(type === 'transform' ? TRANSFORMER_TEMPLATE : IMPORTER_TEMPLATE)
    };

    manifest.Labels.blobId = blob; // eslint-disable-line functional/immutable-data
    manifest.Labels.profile = profile; // eslint-disable-line functional/immutable-data
    manifest.name = `${manifest.name}${profile}-${blob}`; // eslint-disable-line functional/immutable-data

    manifest.Env = getEnv(options.env).concat([ // eslint-disable-line functional/immutable-data
      `API_URL=${API_URL}`,
      `AMQP_URL=${AMQP_URL}`,
      `DEBUG=${DEBUG}`,
      `API_USERNAME=${type === 'transform' ? API_USERNAME_TRANSFORMER : API_USERNAME_IMPORTER}`,
      `API_PASSWORD=${type === 'transform' ? API_PASSWORD_TRANSFORMER : API_PASSWORD_IMPORTER}`,
      `PROFILE_ID=${profile}`,
      `BLOB_ID=${blob}`
    ]);

    const cont = await docker.createContainer(manifest);

    await attachToNetworks();
    await cont.start();

    logger.debug(cont.id ? `ID of started ${type} container: ${cont.id}` : `Creation of ${type} container has failed`);

    function getEnv(env = {}) {
      return Object.keys(env).map(k => `${k}=${env[k]}`);
    }

    function attachToNetworks() {
      return Promise.all(DOCKER_CONTAINER_NETWORKS.map(async networkName => {
        const network = await docker.getNetwork(networkName);

        return network.connect({
          Container: cont.id
        });
      }));
    }
  }

  async function terminateTasks({blob, unhealthy = false} = {}) {
    const filters = genFilter();
    const containersInfo = await docker.listContainers({filters});

    if (containersInfo.length > 0) { // eslint-disable-line functional/no-conditional-statement
      await Promise.all(containersInfo.map(async info => {
        try {
          logger.debug(`CONT:${info.Id}`);
          const cont = await docker.getContainer(info.Id);

          if (info.State === 'running') { // eslint-disable-line functional/no-conditional-statement
            logger.debug('Stopping container');
            await cont.stop();
          }
        } catch (err) {
          logError(err);
        }
      }));
    }

    function genFilter() {
      const baseFilter = {
        label: [LABEL_TASK]
      };

      return genHealth(genBlob(baseFilter));

      function genBlob(filter) {
        if (blob) {
          return {
            ...filter,
            label: filter.label.concat(`blobId=${blob}`)
          };
        }

        return filter;
      }

      function genHealth(filter) {
        if (unhealthy) {
          return {...filter, health: ['unhealthy']};
        }

        return filter;
      }
    }
  }

  function listTasks({blob, profile, type} = {}) {
    const filters = genFilter();

    return docker.listContainers({filters});

    function genFilter() {
      const baseFilter = {
        label: [LABEL_TASK]
      };

      return genType(genBlob(genProfile(baseFilter)));

      function genType(filter) {
        if (type) {
          if (type === 'transform') {
            return addLabel(filter, LABEL_TRANSFORM_TASK);
          }

          if (type === 'import') {
            return addLabel(filter, LABEL_IMPORT_TASK);
          }
        }

        return filter;
      }

      function genBlob(filter) {
        return addLabel(filter, blob ? `blobId=${blob}` : undefined);
      }

      function genProfile(filter) {
        return addLabel(filter, profile ? `profile=${profile}` : undefined);
      }

      function addLabel(filter, label) {
        if (label) {
          return {
            ...filter,
            label: filter.label.concat(label)
          };
        }

        return filter;
      }
    }
  }

  async function pruneTasks() {
    try {
      const result = await docker.pruneContainers({
        all: true,
        filters: {
          label: [LABEL_TASK]
        }
      });

      if (result.ContainersDeleted !== null) { // eslint-disable-line functional/no-conditional-statement
        logger.debug(`Removed ${result.ContainersDeleted.length} inactive tasks`);
      }
    } catch (err) {
      if (err.statusCode !== HttpStatus.CONFLICT) { // eslint-disable-line functional/no-conditional-statement
        throw err;
      }
    }
  }

  async function updateImages(refs) {
    logger.debug(`Checking updates for ${refs.length} images  in the registry`);

    await update(refs);

    logger.debug('Done checking updates for images in the registry');

    async function update(refs) {
      const [ref, ...rest] = refs;

      if (ref) {
        try {
          const result = await getImage();

          if (result && result.image.RepoDigests && result.image.RepoDigests.length > 0 && result.pulled === false) { // eslint-disable-line functional/no-conditional-statement
            await pullImage();
          }

          return update(rest);
        } catch (err) {
          logError(err);
        }

        return update(rest);
      }

      async function getImage() {
        try {
          const image = docker.getImage(ref);

          return {
            image: await image.inspect(),
            pulled: false
          };
        } catch (err) {
          if (err.statusCode === HttpStatus.NOT_FOUND) {
            await pullImage(ref);

            const image = docker.getImage(ref);

            return {
              image: await image.inspect(),
              pulled: true
            };
          }
        }
      }

      async function pullImage() {
        const stream = await docker.pull(ref);

        return new Promise((resolve, reject) => {
          let pullingImage; // eslint-disable-line functional/no-let

          docker.modem.followProgress(stream, finishCallback, progressCallback);

          function finishCallback(err) {
            if (err) {
              return reject(err);
            }

            resolve();
          }

          function progressCallback(event) {
            if ((/^Status: Downloaded newer image/u).test(event.status)) { // eslint-disable-line functional/no-conditional-statement
              logger.info(`Completed dowloading new version of ${ref}`);
              return;
            }

            if ((/^Pulling fs layer/u).test(event.status) && !pullingImage) { // eslint-disable-line functional/no-conditional-statement
              logger.info(`Image ${ref} has been updated in the registry or does not exist locally. Pulling from the registry`);
              pullingImage = true;
            }
          }
        });
      }
    }
  }
};
