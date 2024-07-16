// import {expect} from 'chai';
import {READERS} from '@natlibfi/fixura';
import generateTests from '@natlibfi/fixugen';
import mongoFixturesFactory from '@natlibfi/fixura-mongo';
import {expect} from 'chai';
import startApp from './app';

let mongoFixtures; // eslint-disable-line functional/no-let

generateTests({
  callback,
  path: [__dirname, '..', 'test-fixtures', 'clean'],
  recurse: false,
  useMetadataFile: true,
  fixura: {
    failWhenNotFound: true,
    reader: READERS.JSON
  },
  mocha: {
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
    rootPath: [__dirname, '..', 'test-fixtures', 'clean'],
    gridFS: {bucketName: 'blobs'},
    useObjectId: true,
    format: {
      blobmetadatas: {
        modificationTime: v => new Date(v)
      }
    }
  });
}

async function callback({
  getFixture,
  mongoDatabaseAndCollections
}) {
  const mongoUri = await mongoFixtures.getUri();
  await mongoFixtures.populate(getFixture('dbContents.json'));
  await startApp({mongoUri, mongoDatabaseAndCollections}, '2021-05-08', true);
  const dump = await mongoFixtures.dump();
  const expectedResult = await getFixture('expectedResult.json');
  expect(dump).to.eql(expectedResult);
}
