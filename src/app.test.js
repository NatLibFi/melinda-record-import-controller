import assert from 'node:assert';
import * as fakeAmqpLib from '@onify/fake-amqplib';
import {READERS} from '@natlibfi/fixura';
import generateTests from '@natlibfi/fixugen';
import mongoFixturesFactory from '@natlibfi/fixura-mongo';
import {createAmqpOperator} from '@natlibfi/melinda-record-import-commons';

import {startApp} from './app.js';
import {testMoment} from './config.js';

let mongoFixtures;

generateTests({
  callback,
  path: [import.meta.dirname, '..', 'test-fixtures', 'clean'],
  recurse: false,
  useMetadataFile: true,
  fixura: {
    failWhenNotFound: true,
    reader: READERS.JSON
  },
  hooks: {
    before: async () => {
      await initMongofixtures();
    },
    beforeEach: () => mongoFixtures.clear(),
    afterEach: () => mongoFixtures.clear(),
    after: async () => {
      await mongoFixtures.close();
    }
  }
});

async function initMongofixtures() {
  mongoFixtures = await mongoFixturesFactory({
    rootPath: [import.meta.dirname, '..', 'test-fixtures', 'clean'],
    gridFS: {bucketName: 'blobmetadatas'},
    useObjectId: true
  });
}

async function callback({
  getFixture,
  mongoDatabaseAndCollections,
  prepareQueueConfigs = []
}) {
  const amqpOperator = await createAmqpOperator(fakeAmqpLib, 'amqp://example.com');
  await prepareQueues(amqpOperator, prepareQueueConfigs);
  const mongoUrl = await mongoFixtures.getUri();
  const amqpUrl = 'amqp://example.com';
  await mongoFixtures.populate(getFixture('dbContents.json'));
  await startApp({mongoUrl, amqpUrl, mongoDatabaseAndCollections}, fakeAmqpLib, testMoment);
  const dump = await mongoFixtures.dump();
  const expectedResult = await getFixture('expectedResult.json');
  assert.deepStrictEqual(dump, expectedResult);

  await amqpOperator.closeChannel();
  await amqpOperator.closeConnection();
}

async function prepareQueues(amqpOperator, prepareQueueConfigs) {
  const [config, ...rest] = prepareQueueConfigs;

  if (config === undefined) {
    return;
  }

  const {queue, recordsToQueue} = config;
  const records = prepareRecords(recordsToQueue);
  await sendRecordsToQueue(queue, records);
  // const count = await amqpOperator.countQueue({blobId, status});
  // console.log(`${count} records prepared for test`); // eslint-disable-line
  return prepareQueues(amqpOperator, rest);

  async function sendRecordsToQueue(queue, records) {
    const [record, ...rest] = records;
    if (record === undefined) {
      return;
    }
    const {blobId, status} = queue;
    await amqpOperator.sendToQueue({blobId, status, headers: {test: true}, data: record});
    return sendRecordsToQueue(queue, rest);
  }

  function prepareRecords(amount) {
    return new Array(amount)
      .fill({})
      .map((obj, index) => ({'leader': '02518cam a2200745zi 4500', 'fields': [{'tag': '001', 'value': `${index + 1}`.padStart(9, '0')}]}));
  }
}