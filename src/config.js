import {readEnvironmentVariable} from '@natlibfi/melinda-backend-commons';

export const mongoUri = readEnvironmentVariable('MONGO_URI', {defaultValue: 'mongodb://127.0.0.1:27017/db'});
export const mongoDatabaseAndCollections = readEnvironmentVariable('MONGO_DATABASE_AND_COLLECTIONS', {defaultValue: [], format: v => JSON.parse(v)});
export const pollTime = readEnvironmentVariable('POLL_TIME', {defaultValue: 21600000}); // 6h in ms (1000 ms / 60 sec / 60 min)

export const testMoment = '2021-05-08'; // Date for testing
export const earliestMoment = '2000-01-01'; // Earliest date for filtering
